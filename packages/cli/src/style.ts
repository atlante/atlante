export type Style = (text: string) => string;

export type Styler = {
  error: Style;
  warning: Style;
  success: Style;
  dim: Style;
};

const RESET = "\x1b[0m";

function styled(code: string): Style {
  return (text) => `${code}${text}${RESET}`;
}

function plainStyler(): Styler {
  const identity: Style = (text) => text;
  return {
    error: identity,
    warning: identity,
    success: identity,
    dim: identity,
  };
}

/**
 * Terminal styles for CLI output. Every style is an identity function on a
 * non-interactive stream or when `NO_COLOR` is set, so piped, redirected, and
 * opted-out output stays byte-identical to plain text (an empty `NO_COLOR`
 * value does not opt out, per no-color.org). The stream and environment are
 * injectable so tests can pin either branch deterministically.
 */
export function createStyler(
  stream: { isTTY?: boolean } = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): Styler {
  if (env.NO_COLOR || !stream.isTTY) return plainStyler();
  return {
    error: styled("\x1b[31m"),
    warning: styled("\x1b[33m"),
    success: styled("\x1b[32m"),
    dim: styled("\x1b[90m"),
  };
}
