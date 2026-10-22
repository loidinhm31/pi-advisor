import { Input, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component, Focusable } from "@earendil-works/pi-tui";

import { isNumber } from "../content-utils.ts";

export interface MaskedInputOptions {
  onEscape?: () => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
}

interface InputCursorAdapterContract {
  cursor?: number;
  debugState?: () => { cursor?: number };
  getCursor?: () => number;
}

const resolveRawCursor = (
  input: InputCursorAdapterContract
): number | undefined => {
  if (input.getCursor) {
    return input.getCursor();
  }
  if (input.debugState) {
    return input.debugState().cursor;
  }
  return input.cursor;
};

const resolveInputCursor = (
  input: InputCursorAdapterContract,
  valueLength: number
): number => {
  const rawCursor = resolveRawCursor(input);
  return isNumber(rawCursor) && Number.isFinite(rawCursor)
    ? Math.max(0, Math.min(Math.trunc(rawCursor), valueLength))
    : valueLength;
};

/** Single-line secret input rendering bullets; the value never reaches the screen. */
export class MaskedInput implements Component, Focusable {
  private readonly input: Input;
  private readonly options: MaskedInputOptions;
  private _focused = true;

  constructor(options: MaskedInputOptions = {}) {
    this.options = options;
    this.input = new Input({ placeholder: options.placeholder });
    this.input.focused = true;
    this.input.onSubmit = (value) => options.onSubmit?.(value);
    this.input.onEscape = () => options.onEscape?.();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  getValue(): string {
    return this.input.getValue();
  }

  setValue(value: string): void {
    this.input.setValue(value);
  }

  handleInput(keyData: string): void {
    this.input.handleInput(keyData);
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    const value = this.input.getValue();
    const hostInput: Component = this.input;
    // SAFETY: Input exposes public getCursor() on OMP and private cursor on Pi 1.x.
    const cursor = resolveInputCursor(
      hostInput as InputCursorAdapterContract,
      value.length
    );
    const masked = `${"•".repeat(cursor)}█${"•".repeat(Math.max(0, value.length - cursor))}`;
    const placeholder =
      value.length === 0 && this.options.placeholder
        ? this.options.placeholder
        : masked;

    return [truncateToWidth(placeholder, Math.max(1, width))];
  }
}
