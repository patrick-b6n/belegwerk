import { useCallback, useEffect, useRef, useState } from "react";

export interface DebouncedInputOptions {
  /** The value's text as it currently is in the URL (or other source of truth). */
  readonly source: string;
  /** Called with the typed text once typing pauses (and on {@link DebouncedInput.flush}). */
  readonly onCommit: (text: string) => void;
  /**
   * Whether the typed text already stands for `source` – then a change of
   * `source` (e.g. after the own commit) leaves the input alone. Default:
   * equal strings.
   */
  readonly matches?: (text: string, source: string) => boolean;
  /** Milliseconds without typing before committing; default 300. */
  readonly delay?: number;
}

export interface DebouncedInput {
  readonly value: string;
  readonly onChange: (text: string) => void;
  /** Commits a pending change right away (e.g. on blur or Enter). */
  readonly flush: () => void;
}

const sameText = (text: string, source: string) => text === source;

/**
 * A text input bound to an external value (a URL search param) that commits
 * changes debounced. When the external value changes for another reason
 * (back/forward, "Filter zurücksetzen", a link), a pending commit is dropped
 * and the input shows the new value – unless the typed text already matches
 * it (`matches`) or the change is the own commit's, so that does not
 * overwrite what was typed since.
 */
export function useDebouncedInput({
  source,
  onCommit,
  matches = sameText,
  delay = 300,
}: DebouncedInputOptions): DebouncedInput {
  const [value, setValue] = useState(source);
  const valueRef = useRef(source);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(false);
  // The text of the last commit until its URL change arrives: typing may go
  // on in between, and that change must not overwrite the newer text.
  const committed = useRef<string | undefined>(undefined);
  const commitRef = useRef(onCommit);
  const matchesRef = useRef(matches);

  useEffect(() => {
    commitRef.current = onCommit;
    matchesRef.current = matches;
  });

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = false;
  }, []);

  useEffect(() => {
    const ownCommit =
      committed.current !== undefined && matchesRef.current(committed.current, source);
    committed.current = undefined;
    if (ownCommit || matchesRef.current(valueRef.current, source)) return;
    cancel();
    valueRef.current = source;
    setValue(source);
  }, [source, cancel]);

  useEffect(() => cancel, [cancel]);

  const flush = useCallback(() => {
    if (!pending.current) return;
    cancel();
    committed.current = valueRef.current;
    commitRef.current(valueRef.current);
  }, [cancel]);

  const onChange = useCallback(
    (text: string) => {
      valueRef.current = text;
      setValue(text);
      clearTimeout(timer.current);
      pending.current = true;
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );

  return { value, onChange, flush };
}
