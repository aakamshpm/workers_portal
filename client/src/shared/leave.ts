/**
 * Leave this app for another one. ADR-0012.
 *
 * Each app is its own bundle at its own address, so going from the worker app
 * to the sign-in page is a full page load, not a router change. `replace` is
 * used so the page the user was turned away from does not stay in the browser
 * history and catch the Back button.
 *
 * Kept in its own module so tests can replace it and check where an app sent
 * someone, without the test runner trying to load a real page.
 */
export function leaveTo(path: string): void {
  window.location.replace(path);
}
