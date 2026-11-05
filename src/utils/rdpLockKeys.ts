/**
 * NumLock for the embedded RDP client (IronRDP).
 *
 * IronRDP synchronises the lock keys with the server from `KeyboardEvent.getModifierState()`
 * whenever a lock key (NumLock, CapsLock, ScrollLock) is pressed. WebKitGTK (Linux) does not
 * implement the "NumLock" modifier – it always reports `false` (checked in WebKitGTK 2.52). So on
 * Linux every press of NumLock *or CapsLock* switched NumLock off on the server, and the numeric
 * keypad sent Home/End/arrows instead of digits.
 *
 * The real state is visible in the keypad events themselves: with NumLock on, `Numpad1` produces
 * the key "1", with NumLock off "End". The state is learnt from them (and toggled by the NumLock
 * key), `getModifierState('NumLock')` returns it on WebKit, and before a keypad key is sent the
 * server is synchronised if its state differs.
 */

let numLock: boolean | null = null;
let installed = false;

const KEYPAD_VALUE = /^Numpad(\d|Decimal)$/;

/** NumLock state shown by a keypad key event (null = the event says nothing about it). */
export function numLockFromEvent(e: Pick<KeyboardEvent, 'code' | 'key' | 'shiftKey'>): boolean | null {
  if (!KEYPAD_VALUE.test(e.code) || e.shiftKey) return null; // Shift inverts the keypad
  if (/^[0-9]$/.test(e.key) || e.key === '.' || e.key === ',') return true;
  if (e.key === 'Unidentified' || e.key === '') return null;
  return false; // Insert, End, ArrowDown, Clear, Delete ...
}

export function currentNumLock(): boolean | null {
  return numLock;
}

/** Updates the tracked state from a key event (capture phase, before IronRDP sees it). */
export function trackNumLock(e: KeyboardEvent): void {
  if (e.type !== 'keydown') return;
  if (e.code === 'NumLock') {
    if (!e.repeat && numLock !== null) numLock = !numLock;
    return;
  }
  const state = numLockFromEvent(e);
  if (state !== null) numLock = state;
}

/** WebKit: make `getModifierState('NumLock')` return the learnt state instead of always false. */
export function installNumLockModifierFix(): void {
  if (installed || typeof KeyboardEvent === 'undefined') return;
  installed = true;
  const native = KeyboardEvent.prototype.getModifierState;
  KeyboardEvent.prototype.getModifierState = function (this: KeyboardEvent, key: string): boolean {
    if (key === 'NumLock' && numLock !== null) return numLock;
    return native.call(this, key);
  };
}
