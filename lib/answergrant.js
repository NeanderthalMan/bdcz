/**
 * A grant: permission to give one answer, and nothing else.
 *
 * bc-0fsod. An ntfy action button is a POST the *relay* makes on the phone's behalf,
 * so whatever authorises it is written into the notification — and a notification on
 * `https://ntfy.sh` is a message on a public server, readable by anyone who has the
 * topic name and cached there for hours. Until this bead that credential was
 * `cfg.token` itself: the daemon's whole API, handed to the relay on every question.
 *
 * A grant is what the button carries instead. It is an HMAC over exactly the answer
 * the button gives — workspace, bead id, option id and the response text — plus an
 * expiry, so someone reading it off the relay can do precisely what the button does,
 * once, and nothing else. It cannot read a card, answer a different bead or say a
 * different sentence, and it is refused the second time it is used.
 *
 * The key is derived from `cfg.token` rather than being a second secret to keep, so
 * rotating the token (the thing to do if the old one leaked) also voids every grant
 * already sent. The HMAC does not reveal the token.
 *
 * "Once" is kept in memory. A restart forgets which grants were spent, and that is an
 * accepted gap rather than an oversight: the grant is still bound to the one answer it
 * names, and giving that answer again to a bead that already has it is what a second
 * tap on the phone could always do.
 */
import crypto from 'node:crypto';

export const GRANT_HEADER = 'x-beadcause-grant';

/** Long enough for a question to wait weeks on a lock screen, which they do. */
export const GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const keyOf = (token) => crypto.createHash('sha256').update(`beadcause-answer-grant\n${token}`).digest();

const digest = (token, a, exp) =>
  crypto
    .createHmac('sha256', keyOf(token))
    .update(
      [
        'v1',
        a.workspace,
        a.id,
        a.option ?? '',
        crypto.createHash('sha256').update(String(a.response ?? '')).digest('hex'),
        exp,
      ].join('\n')
    )
    .digest('base64url');

/** The grant for one answer: `v1.<expiry ms>.<hmac>`. */
export function grantFor(token, answer, now = Date.now(), ttl = GRANT_TTL_MS) {
  if (!token) throw new Error('an answer grant needs cfg.token to sign with');
  const exp = now + ttl;
  return `v1.${exp}.${digest(token, answer, exp)}`;
}

/**
 * A checker with its own memory of spent grants.
 *
 * Returns `null` when the grant authorises exactly this answer, or a short reason
 * when it does not. A grant is spent only when it checks out, so a malformed or
 * forged one cannot use up a real one.
 */
export function createGrantChecker(tokenOf) {
  const spent = new Map(); // grant → expiry
  return function check(grant, answer, now = Date.now()) {
    for (const [g, exp] of spent) if (exp < now) spent.delete(g);
    const token = tokenOf();
    const m = /^v1\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/.exec(String(grant || ''));
    if (!token || !m) return 'malformed grant';
    const exp = Number(m[1]);
    if (exp < now) return 'grant expired';
    const want = Buffer.from(digest(token, answer, exp));
    const got = Buffer.from(m[2]);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return 'grant does not match this answer';
    if (spent.has(grant)) return 'grant already used';
    spent.set(grant, exp);
    return null;
  };
}
