/** Matches a character an HTTP header value cannot carry: anything but printable ASCII. */
export const NOT_HEADER_SAFE = /[^ -~]/
