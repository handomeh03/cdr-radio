import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Disables the buttons while the next page is loading. */
  disabled?: boolean;
}

/** Previous/next controls for the backend's page-number pagination. */
export function Pagination({ page, totalPages, total, onPageChange, disabled }: PaginationProps) {
  if (totalPages <= 1) return <p className="text-sm text-muted-foreground">{total} total</p>;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Page {page} of {totalPages} · {total} total
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeftIcon aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
