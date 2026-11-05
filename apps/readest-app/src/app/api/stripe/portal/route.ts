import { NextResponse } from 'next/server';

export async function POST(_request?: Request | unknown) {
  return NextResponse.json({ error: 'Payments are disabled' }, { status: 400 });
}
