import { revalidateLogic, type ValidationLogicFn } from "@tanstack/react-form";

/**
 * `revalidateLogic()` (validate on submit, after the first submit on every
 * change), except that blurring a field keeps its server errors
 * (`errorMap.onServer`).
 *
 * form-core (checked against 1.33.5, `ValidationLogic.js`) adds a no-op
 * "server" validator to the blur, change and submit events, which clears
 * `onServer`. On blur that would drop a business-layer error (e.g. "category
 * archived") as soon as the user tabs past the field, before fixing it. So on
 * blur the server validator is filtered out; a change of the value or the
 * next submit still clears it.
 *
 * Note: form-core only consults the validation logic for fields that have a
 * `validators` object – a field without one never clears `onServer` (give it
 * a no-op validator).
 */
export function revalidateKeepingServerErrorsOnBlur(): ValidationLogicFn {
  const base = revalidateLogic();
  return (props) =>
    base({
      ...props,
      runValidation: (run) =>
        props.runValidation(
          props.event.type === "blur"
            ? { ...run, validators: run.validators.filter((v) => v?.cause !== "server") }
            : run,
        ),
    });
}

/** A validator that never fails: makes form-core clear a field's server error on change. */
export const noValidation = (): undefined => undefined;
