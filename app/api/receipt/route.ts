import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  categorizeByKeywords,
  normalizeCategory,
  type ExpenseCategory,
} from "../../../lib/categories";

type ExpensePayload = {
  date: string;
  amount: number;
  description: string;
  store?: string;
  category?: string;
};

type GeminiReceiptResult = {
  reply?: string;
  expense?: ExpensePayload | null;
  need_clarification?: boolean;
};

const MODEL_CANDIDATES = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
];

const MAX_BYTES = 8 * 1024 * 1024;

function getTodayKst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function buildReceiptPrompt(today: string) {
  return `당신은 영수증 OCR/분석 도우미입니다.
이미지에서 결제 정보를 읽고 JSON으로만 답하세요.

오늘 날짜: ${today}

추출 항목:
- date: 영수증 날짜 (YYYY-MM-DD). 없으면 ${today}
- amount: 총 결제 금액(원, 정수). 합계/총액/받을금액 우선
- description: 가게 이름(짧고 자연스럽게). 없으면 "영수증"
- store: 가게 이름(있으면)
- category: 반드시 다음 중 하나 - 식비, 교통, 쇼핑, 문화, 기타

규칙:
1. 영수증이 아니거나 금액을 못 읽으면 expense는 null, need_clarification은 true
2. 성공 시 reply 예: "스타벅스 12월 1일 5,400원(식비)을 저장했어요!"
3. 보이는 정보로 카테고리를 분류하세요
4. JSON만 출력

{"reply":"문자열","expense":{"date":"YYYY-MM-DD","amount":5400,"description":"스타벅스","store":"스타벅스","category":"식비"},"need_clarification":false}`;
}

function extractJson(text: string): GeminiReceiptResult | null {
  const trimmed = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(trimmed) as GeminiReceiptResult;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as GeminiReceiptResult;
    } catch {
      return null;
    }
  }
}

function isValidExpense(
  expense: ExpensePayload | null | undefined,
): expense is ExpensePayload {
  if (!expense) return false;
  const amount = Number(expense.amount);
  return (
    typeof expense.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(expense.date) &&
    typeof expense.description === "string" &&
    expense.description.trim().length > 0 &&
    Number.isFinite(amount) &&
    amount > 0
  );
}

function formatConfirmReply(expense: {
  date: string;
  amount: number;
  description: string;
  category: ExpenseCategory;
}) {
  const label = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  }).format(new Date(expense.date + "T00:00:00"));
  const amount = new Intl.NumberFormat("ko-KR").format(expense.amount);
  return `${expense.description} ${label} ${amount}원(${expense.category})을 저장했어요!`;
}

async function askGeminiVision(
  apiKey: string,
  prompt: string,
  mimeType: string,
  base64: string,
) {
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError = "";

  for (const modelName of MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      });

      const result = await model.generateContent([
        { text: prompt },
        {
          inlineData: {
            mimeType,
            data: base64,
          },
        },
      ]);

      return { text: result.response.text(), error: "" };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Gemini Vision 호출 실패";
    }
  }

  return { text: "", error: lastError };
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Supabase 환경 변수가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("image");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "영수증 이미지를 업로드해 주세요." },
        { status: 400 },
      );
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "이미지 파일만 업로드할 수 있어요." },
        { status: 400 },
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "이미지가 너무 커요. 8MB 이하로 올려 주세요." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const today = getTodayKst();

    const { text, error: geminiError } = await askGeminiVision(
      apiKey,
      buildReceiptPrompt(today),
      file.type || "image/jpeg",
      base64,
    );

    if (!text) {
      return NextResponse.json(
        {
          error: "영수증을 읽지 못했어요. 잠시 후 다시 시도해 주세요.",
          detail: geminiError,
        },
        { status: 502 },
      );
    }

    const parsed = extractJson(text);

    if (!parsed || parsed.need_clarification || !isValidExpense(parsed.expense)) {
      return NextResponse.json({
        reply:
          parsed?.reply ||
          "영수증에서 금액이나 가게 이름을 확인하지 못했어요. 더 선명한 사진으로 다시 올려 주세요.",
        expense: null,
      });
    }

    const description = (
      parsed.expense.store || parsed.expense.description
    ).trim();
    const category = parsed.expense.category
      ? normalizeCategory(parsed.expense.category)
      : categorizeByKeywords(description);

    const expenseToSave = {
      date: parsed.expense.date,
      amount: Math.round(Number(parsed.expense.amount)),
      description,
      category,
    };

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from("expenses")
      .insert(expenseToSave)
      .select("id, created_at, date, amount, description, category")
      .single();

    if (error) {
      return NextResponse.json({
        reply: "영수증은 읽었지만 저장에 실패했어요. 다시 시도해 주세요.",
        expense: null,
        error: error.message,
      });
    }

    return NextResponse.json({
      reply: parsed.reply || formatConfirmReply(expenseToSave),
      expense: data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json(
      {
        error: "영수증 처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
        detail: message,
      },
      { status: 500 },
    );
  }
}
