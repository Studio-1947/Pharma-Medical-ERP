/**
 * Turns anything the API (or the network) throws into words a non-technical
 * person can act on.
 *
 * Most screens read `err.response.data.message` straight onto the screen. That
 * is fine when the server wrote the sentence for a human, and useless when it
 * did not — "Request failed with status code 500", "Network Error", or a raw
 * Postgres complaint tells a cashier nothing about what to do next.
 *
 * Three things come out of here, and the UI should show all three:
 *   - `title`     what happened, in four or five words
 *   - `message`   the detail, preferring the server's sentence when it wrote one
 *   - `whatToDo`  the next action, because the person is mid-task
 *   - `reference` a short code to read out when they need to ring someone
 */

export interface ExplainedError {
  title: string;
  message: string;
  whatToDo?: string;
  reference?: string;
  /** True when repeating the same action is expected to work. */
  retryable: boolean;
}

interface ApiErrorBody {
  code?: string;
  message?: string;
  reference?: string;
  errors?: Record<string, string[] | undefined>;
}

/** Sentences we know were written for a machine, never for a person. */
const OPAQUE = [
  /^request failed with status code/i,
  /^network error$/i,
  /^internal server error$/i,
  /^timeout of \d+ms exceeded$/i,
  /^canceled$/i,
];

function isHumanSentence(message?: string): message is string {
  if (!message || message.length < 8) return false;
  return !OPAQUE.some((re) => re.test(message.trim()));
}

/** Field-level validation errors, flattened into one readable line. */
function describeFieldErrors(errors?: ApiErrorBody["errors"]): string | undefined {
  if (!errors) return undefined;
  const parts = Object.entries(errors)
    .filter(([, msgs]) => msgs?.length)
    .map(([field, msgs]) => `${humaniseFieldName(field)}: ${msgs![0]}`);
  return parts.length ? parts.join("; ") : undefined;
}

function humaniseFieldName(field: string): string {
  return field
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._]/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

const BY_CODE: Record<string, Omit<ExplainedError, "message" | "reference">> = {
  NOT_SIGNED_IN: {
    title: "You have been signed out",
    whatToDo: "Sign in again to carry on. Nothing you had entered was saved.",
    retryable: false,
  },
  NOT_PERMITTED: {
    title: "You do not have access to this",
    whatToDo: "Ask an administrator to give your account permission.",
    retryable: false,
  },
  NOT_FOUND: {
    title: "Not found",
    whatToDo: "It may have been deleted. Refresh the page and look again.",
    retryable: false,
  },
  DUPLICATE: {
    title: "This already exists",
    whatToDo: "Check whether it was already saved before entering it again.",
    retryable: false,
  },
  VALIDATION_FAILED: {
    title: "Some details need fixing",
    whatToDo: "Correct the highlighted fields and save again.",
    retryable: false,
  },
  REQUIRED_FIELD: {
    title: "Something is missing",
    whatToDo: "Fill in the missing field and try again.",
    retryable: false,
  },
  INVALID_VALUE: {
    title: "One of the values is not valid",
    whatToDo: "Check the highlighted field and enter it again.",
    retryable: false,
  },
  MISSING_REFERENCE: {
    title: "Something it depends on is missing",
    whatToDo: "Refresh the page and try again. If it keeps happening, tell an administrator.",
    retryable: true,
  },
  CANNOT_COMPLETE: {
    title: "This cannot be done right now",
    whatToDo: "Read the reason above — it usually says what to change.",
    retryable: false,
  },
  RETRY_SAFE: {
    title: "Two tills clashed",
    whatToDo: "Nothing was saved. Try again — it should go through this time.",
    retryable: true,
  },
  TOO_MANY_REQUESTS: {
    title: "Too many requests",
    whatToDo: "Wait a few seconds and try again.",
    retryable: true,
  },
  SCHEMA_MISMATCH: {
    title: "This feature is not ready on this server",
    whatToDo:
      "The app has been updated but the database has not. Send the reference below to whoever manages your system — nobody at the counter can fix this.",
    retryable: false,
  },
  INTERNAL_ERROR: {
    title: "Something went wrong at our end",
    whatToDo:
      "This is not something you did. Try once more, and if it happens again send the reference below to support.",
    retryable: true,
  },
};

const OFFLINE: ExplainedError = {
  title: "No connection",
  message: "The app cannot reach the server.",
  whatToDo:
    "Check the internet connection. Sales made at the till are saved on this device and will be sent automatically once you are back online.",
  retryable: true,
};

export function explainError(err: unknown): ExplainedError {
  // A stored failure reason, replayed later from the offline queue. It is
  // already a sentence; the only question is whether a person wrote it.
  if (typeof err === "string") {
    return isHumanSentence(err)
      ? { title: "That did not go through", message: err, retryable: true }
      : { ...BY_CODE.INTERNAL_ERROR!, message: "The server did not accept it." };
  }

  const anyErr = err as {
    response?: { status?: number; data?: ApiErrorBody };
    code?: string;
    message?: string;
  };

  // No response at all: the request never reached the server.
  if (!anyErr?.response) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return OFFLINE;
    if (anyErr?.code === "ECONNABORTED") {
      return {
        title: "The server took too long",
        message: "The request timed out before the server answered.",
        whatToDo: "Try again. If the sale may have gone through, check the invoice list before re-entering it.",
        retryable: true,
      };
    }
    return OFFLINE;
  }

  const body = anyErr.response.data ?? {};
  const base = BY_CODE[body.code ?? ""] ?? BY_CODE.INTERNAL_ERROR!;

  const fieldDetail = describeFieldErrors(body.errors);
  const serverSentence = isHumanSentence(body.message) ? body.message : undefined;

  return {
    ...base,
    message: fieldDetail ?? serverSentence ?? base.title,
    reference: body.reference,
  };
}

/** Convenience for the many call sites that only have room for one line. */
export function errorText(err: unknown): string {
  const e = explainError(err);
  return e.whatToDo ? `${e.message} ${e.whatToDo}` : e.message;
}
