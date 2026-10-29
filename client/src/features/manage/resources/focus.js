// Focus helpers of the listing form (kept out of the .jsx files, which export only components).

/** The control a field path's error link focuses: a row's first input, a list's group, the uploader. */
export function focusPathFor(path) {
  if (/^eligibility\.(departments|badges)\.\d+$/.test(path)) return path.replace(/\.\d+$/, '');
  if (/^images\.\d+$/.test(path)) return 'images';
  if (/^availability\.weekly\.\d+$/.test(path)) return `${path}.open`;
  if (/^availability\.blackouts\.\d+$/.test(path)) return `${path}.start`;
  return path;
}

/** Moves focus to an element by id (which scrolls it into view); false when it isn't on the page. */
export function focusById(id) {
  const element = typeof document === 'undefined' ? null : document.getElementById(id);
  if (!element) return false;
  element.focus();
  element.scrollIntoView?.({ block: 'center' });
  return true;
}
