import { NextResponse } from 'next/server';

export async function GET(_request?: Request | unknown) {
  return NextResponse.json({ plans: [] });
}
