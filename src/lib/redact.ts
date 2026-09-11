/**
 * Strip email addresses out of text that came from somewhere else.
 *
 * Upstream error messages are echoed onto /sources so a broken feed is
 * diagnosable without opening a log. Some of them quote the request back:
 * SEC_USER_AGENT is required to carry a real contact address, so an EDGAR
 * block message can contain it verbatim. That is fine on a private tool and
 * not fine on one anybody can open, and the fix belongs at the point of
 * display — the stored error should stay complete for whoever is debugging it.
 */

// Deliberately broad on the local part. Over-redacting an error message costs
// nothing; under-redacting publishes an address.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function redactEmails(text: string): string {
  return text.replace(EMAIL, "[email removed]");
}
