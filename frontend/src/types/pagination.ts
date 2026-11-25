/** Paginated list envelope returned by the backend's list endpoints (tracks, playlists). */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
