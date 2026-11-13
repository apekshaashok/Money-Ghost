import { endSession } from '../../../../lib/auth.js';
import { route } from '../../../../lib/api.js';

export const POST = route(async () => {
  endSession();
  return { ok: true };
}, { auth: false });

export const dynamic = 'force-dynamic';
