/**
 * The two numbers that keep a feedback message readable — one place, because
 * the writing side and the reading side have to agree on them.
 *
 * Why they exist (admin feedback 0a0fad31): a topic arrived carrying a single
 * unbroken run of ~9.800 "a" characters. With no cap on the way in, nothing
 * stopped it; with `overflow-wrap: anywhere` on the way out, it re-wrapped into
 * a wall of ~200 lines and pushed every card on the board out of shape.
 */

/**
 * Hard cap on one feedback message — the topic body, a thread reply, an answer
 * to a Rückfrage, and the admin's decline note all share it.
 *
 * Deliberately generous: the point is to stop a paste bomb, not to cut a
 * detailed bug report short. The longest genuine topic on the board so far sits
 * around 1.400 characters, so 2.000 leaves real reports untouched while the
 * 9.800-character run that triggered this is refused at the keyboard.
 */
export const FEEDBACK_MAX_CHARS = 2000;

/**
 * How many characters are left when the live counter stops being grey and
 * starts warning. Early enough to be a heads-up, late enough that it is not on
 * screen for a normal message.
 */
export const FEEDBACK_COUNTER_WARN_AT = 200;

/**
 * A whitespace-free token at least this long is rendered on ONE line and is
 * allowed to overflow its container horizontally, instead of being broken
 * mid-word (`renderFeedbackBody` marks it, `.sc-longword` in styles.scss does
 * the rendering).
 *
 * 64 sits above anything a human types — the longest word in a real German
 * report is well under 40 — and above the everyday pasted URL, so links keep
 * their old, readable mid-word wrap. What it does catch is the pathological
 * case: a token that long is not prose, it is a paste, and a paste has no
 * business reflowing the layout around it.
 */
export const FEEDBACK_LONG_WORD_CHARS = 64;

/** Cut `value` down to the shared cap, leaving anything shorter untouched. */
export function clampFeedbackText(value: string): string {
  return value.length > FEEDBACK_MAX_CHARS ? value.slice(0, FEEDBACK_MAX_CHARS) : value;
}
