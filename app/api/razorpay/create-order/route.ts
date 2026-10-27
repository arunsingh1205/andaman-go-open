import { NextResponse } from "next/server";
import { createOrder, MIN_AMOUNT_PAISE } from "@/lib/razorpay";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Bad request." }, { status: 400 });
  }

  const { amount, currency, receipt } = (body ?? {}) as {
    amount?: unknown;
    currency?: unknown;
    receipt?: unknown;
  };

  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < MIN_AMOUNT_PAISE) {
    return NextResponse.json(
      { message: `Amount must be an integer of at least ${MIN_AMOUNT_PAISE} paise.` },
      { status: 400 },
    );
  }

  try {
    const order = await createOrder({
      amountPaise: amount,
      currency: typeof currency === "string" && currency ? currency : "INR",
      receipt: typeof receipt === "string" ? receipt : undefined,
    });

    return NextResponse.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (error) {
    // Two different error shapes can land here: Razorpay's SDK throws an
    // { statusCode, error: { description } } object for an API-level
    // rejection (bad key, inactive account, ...), while a config problem in
    // lib/razorpay.ts (env vars missing) throws a plain Error instead. Show
    // whichever detail is actually present rather than a one-size-fits-all
    // message that hides which of those it is.
    const normalized = error as { statusCode?: number; error?: { description?: string } } | null;
    const status = normalized?.statusCode === 401 ? 401 : 500;
    const detail = normalized?.error?.description ?? (error instanceof Error ? error.message : undefined);
    return NextResponse.json(
      {
        message:
          status === 401
            ? `Razorpay authentication failed.${detail ? ` ${detail}` : ""}`
            : `Could not create the order.${detail ? ` ${detail}` : ""}`,
      },
      { status },
    );
  }
}
