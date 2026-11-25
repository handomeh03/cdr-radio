/** Shape of error bodies returned by the NestJS backend. */
export interface ApiErrorBody {
  statusCode?: number;
  /** A string, or a list of validation messages (class-validator). */
  message?: string | string[];
  error?: string;
}
