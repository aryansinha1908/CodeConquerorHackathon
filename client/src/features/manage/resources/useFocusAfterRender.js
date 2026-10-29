import { useEffect, useRef } from 'react';

/**
 * Focus for list editing: `focusLater(id)` in the handler that adds, moves or removes a row, and
 * the element with that id takes focus once the change has rendered, so focus never falls to
 * <body> with the button that went away. The target is kept in a ref, not state: the list update
 * already re-renders.
 */
export function useFocusAfterRender() {
  const target = useRef(null);
  useEffect(() => {
    const id = target.current;
    if (!id) return;
    target.current = null;
    document.getElementById(id)?.focus();
  });
  return (id) => {
    target.current = id;
  };
}
