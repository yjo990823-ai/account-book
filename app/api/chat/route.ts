import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type ChatRequest = {
  message: string;
};

type ExpensePayload = {
  date: string;
  amount: number;
  description: string;
};

type ExpenseRow = ExpensePayload & {
  id: number;
  created_at: string;
};

type GeminiResult = {
  intent?: "expense" | "question" | "other";
  reply?: string;
  expense?: ExpensePayload | null;
  need_clarification?: boolean;
};

const MODEL_CANDIDATES = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
];

function getTodayKst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getYesterdayKst() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
  );
  now.setDate(now.getDate() - 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hasAmountMention(message: string) {
  return /(\d[\d,]*)\s*(원|만원|천원)|(\d+)\s*만\s*원?|만원|\d{3,}/.test(message);
}

function hasQuestionCue(message: string) {
  return /(얼마|뭐|무엇|어떤|어떻게|어디|언제|총|합계|가장|많이|비교|통계|알려|보여|몇|있을까|있니|야\?|\?)/.test(
    message,
  );
}

function detectIntent(message: string): "expense" | "question" {
  const amount = hasAmountMention(message);
  const question = hasQuestionCue(message);

  // 금액이 있고 질문이 아니면 지출 입력
  if (amount && !question) return "expense";
  // 의문사/질문 표현이 있으면 질문
  if (question && !amount) return "question";
  // 둘 다 있으면: "식비로 얼마 썼어?"처럼 질문 우선
  if (question) return "question";
  // 금액만 확실하면 지출
  if (amount) return "expense";
  // 기본은 질문/안내로 처리
  return "question";
}

function buildExpensePrompt(today: string, yesterday: string) {
  return `당신은 친절한 한국어 가계부 챗봇입니다.
사용자가 지출을 기록하려고 합니다. 날짜, 금액, 내용을 추출하세요.

기준 날짜:
- 오늘: ${today}
- 어제: ${yesterday}
- 연도가 없으면 ${today.slice(0, 4)}년 사용
- date는 YYYY-MM-DD
- amount는 원 단위 정수 ("2만원" = 20000)
- description은 짧은 한국어

규칙:
1. 정보가 충분하면 expense를 채우고 reply에 저장 확인 문구를 쓰세요.
2. 날짜나 금액이 불명확하면 expense는 null, need_clarification은 true, 부족한 정보를 물어보세요.
3. JSON만 출력하세요.

{"reply":"문자열","expense":{"date":"YYYY-MM-DD","amount":20000,"description":"택시"},"need_clarification":false}`;
}

function buildQuestionPrompt(
  today: string,
  yesterday: string,
  expenses: ExpenseRow[],
) {
  return `당신은 친절한 한국어 가계부 분석 도우미입니다.
사용자의 통계/조회 질문에 답하세요. 말투는 자연스럽고 친근하게.

기준 날짜:
- 오늘: ${today}
- 어제: ${yesterday}
- 이번 달은 ${today.slice(0, 7)} 입니다.

지출 데이터(JSON):
${JSON.stringify(expenses)}

규칙:
1. 반드시 위 데이터만 근거로 답하세요. 없는 내용은 추측하지 마세요.
2. 금액은 천 단위 콤마로 읽기 쉽게 말하세요.
3. 데이터가 비어 있으면 아직 기록이 없다고 안내하세요.
4. expense는 항상 null입니다. 질문에는 저장하지 마세요.
5. JSON만 출력하세요.

{"reply":"친근한 답변","expense":null,"need_clarification":false}`;
}

function extractJson(text: string): GeminiResult | null {
  const trimmed = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(trimmed) as GeminiResult;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as GeminiResult;
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

function formatConfirmReply(expense: ExpensePayload) {
  const label = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  }).format(new Date(expense.date + "T00:00:00"));
  const amount = new Intl.NumberFormat("ko-KR").format(expense.amount);
  return `${label} ${expense.description} ${amount}원을 저장했어요!`;
}

async function askGemini(apiKey: string, systemPrompt: string, message: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError = "";

  for (const modelName of MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      });

      const result = await model.generateContent([
        { text: systemPrompt },
        { text: `사용자 메시지: ${message}` },
      ]);

      return { text: result.response.text(), error: "" };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Gemini 호출 실패";
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

    const body = (await request.json()) as ChatRequest;
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json(
        { error: "메시지를 입력해 주세요." },
        { status: 400 },
      );
    }

    const today = getTodayKst();
    const yesterday = getYesterdayKst();
    const intent = detectIntent(message);
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ----- 통계/조회 질문 -----
    if (intent === "question") {
      const { data: expenses, error: fetchError } = await supabase
        .from("expenses")
        .select("id, created_at, date, amount, description")
        .order("date", { ascending: false });

      if (fetchError) {
        return NextResponse.json({
          reply: "지출 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
          expense: null,
          error: fetchError.message,
        });
      }

      const rows = (expenses ?? []) as ExpenseRow[];
      const { text, error: geminiError } = await askGemini(
        apiKey,
        buildQuestionPrompt(today, yesterday, rows),
        message,
      );

      if (!text) {
        return NextResponse.json(
          {
            error: "AI 응답을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.",
            detail: geminiError,
          },
          { status: 502 },
        );
      }

      const parsed = extractJson(text);
      return NextResponse.json({
        reply:
          parsed?.reply ||
          (rows.length === 0
            ? "아직 저장된 지출이 없어요. 먼저 지출을 말해 주세요!"
            : "질문을 이해했어요. 조금 더 구체적으로 물어봐 주시겠어요?"),
        expense: null,
      });
    }

    // ----- 지출 입력 -----
    const { text, error: geminiError } = await askGemini(
      apiKey,
      buildExpensePrompt(today, yesterday),
      message,
    );

    if (!text) {
      return NextResponse.json(
        {
          error: "AI 응답을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.",
          detail: geminiError,
        },
        { status: 502 },
      );
    }

    const parsed = extractJson(text);

    if (!parsed) {
      return NextResponse.json({
        reply:
          "메시지를 이해하지 못했어요. 예: 어제 택시 2만원 / 이번달 총 지출이 얼마야?",
        expense: null,
      });
    }

    if (parsed.need_clarification || !isValidExpense(parsed.expense)) {
      return NextResponse.json({
        reply:
          parsed.reply ||
          "날짜와 금액을 조금 더 알려주세요. 예: 어제 택시 20000원",
        expense: null,
      });
    }

    const expenseToSave: ExpensePayload = {
      date: parsed.expense.date,
      amount: Math.round(Number(parsed.expense.amount)),
      description: parsed.expense.description.trim(),
    };

    const { data, error } = await supabase
      .from("expenses")
      .insert(expenseToSave)
      .select("id, created_at, date, amount, description")
      .single();

    if (error) {
      return NextResponse.json({
        reply: "내용은 파악했지만 저장에 실패했어요. 다시 시도해 주세요.",
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
        error: "서버에서 문제가 발생했어요. 잠시 후 다시 시도해 주세요.",
        detail: message,
      },
      { status: 500 },
    );
  }
}
