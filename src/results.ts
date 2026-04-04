import { MidnamesError } from "./errors.js";

export type Result<T, E = MidnamesError> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: E };

export function success<T, E = MidnamesError>(data: T): Result<T, E> {
  return { success: true, data };
}

export function failure<E = MidnamesError>(error: E): Result<never, E> {
  return { success: false, error };
}

export async function wrapAsync<T>(asyncFn: () => Promise<T>): Promise<Result<T>> {
  try {
    return success(await asyncFn());
  } catch (error) {
    if (error instanceof MidnamesError) return failure(error);
    return failure(
      new MidnamesError(
        error instanceof Error ? error.message : String(error),
        "UNKNOWN_ERROR",
        error,
      ),
    );
  }
}
