import { NextResponse } from 'next/server';

export async function POST(_request?: Request | unknown) {
  return NextResponse.json({ received: true });
}
