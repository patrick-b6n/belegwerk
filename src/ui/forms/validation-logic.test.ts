import { FieldApi, FormApi } from "@tanstack/react-form";
import { describe, expect, it } from "vitest";

import { noValidation, revalidateKeepingServerErrorsOnBlur } from "./validation-logic";

function setup() {
  const form = new FormApi({
    defaultValues: { name: "" },
    validationLogic: revalidateKeepingServerErrorsOnBlur(),
  });
  form.mount();
  const field = new FieldApi({
    form,
    name: "name",
    validators: { onDynamic: ({ value }) => (value === "" ? "required" : undefined) },
  });
  field.mount();
  const setServerError = () =>
    form.setFieldMeta("name", (meta) => ({
      ...meta,
      errorMap: { ...meta.errorMap, onServer: "server" },
      errorSourceMap: { ...meta.errorSourceMap, onServer: "field" },
    }));
  return { form, field, setServerError };
}

describe("revalidateKeepingServerErrorsOnBlur", () => {
  it("keeps a server error on blur", () => {
    const { field, setServerError } = setup();
    field.handleChange("x");
    setServerError();
    field.handleBlur();
    expect(field.state.meta.errors).toEqual(["server"]);
  });

  it("clears a server error when the value changes", () => {
    const { field, setServerError } = setup();
    setServerError();
    field.handleChange("y");
    expect(field.state.meta.errors).toEqual([]);
  });

  it("clears a server error on the next submit", async () => {
    const { form, field, setServerError } = setup();
    field.handleChange("x");
    // Server errors come from a submit; the next one revalidates them.
    await form.handleSubmit();
    setServerError();
    await form.handleSubmit();
    expect(field.state.meta.errors).toEqual([]);
  });

  it("still revalidates on change after a submit", async () => {
    const { form, field } = setup();
    await form.handleSubmit();
    expect(field.state.meta.errors).toEqual(["required"]);
    field.handleChange("z");
    expect(field.state.meta.errors).toEqual([]);
  });

  it("clears server errors of a field with only a no-op validator", () => {
    const form = new FormApi({
      defaultValues: { note: "" },
      validationLogic: revalidateKeepingServerErrorsOnBlur(),
    });
    form.mount();
    const field = new FieldApi({ form, name: "note", validators: { onDynamic: noValidation } });
    field.mount();
    form.setFieldMeta("note", (meta) => ({
      ...meta,
      errorMap: { ...meta.errorMap, onServer: "server" },
    }));
    field.handleChange("a");
    expect(field.state.meta.errors).toEqual([]);
  });
});
