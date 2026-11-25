interface AppHeaderProps {
  title: string;

  /** Right-aligned content, e.g. a user menu. */
  actions?: React.ReactNode;
  /** Navigation rendered under the title row, inside the header's bottom border. */
  nav?: React.ReactNode;
}

export function AppHeader({ title, actions, nav }: AppHeaderProps) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <div className="flex items-baseline gap-2">
          <span className="font-heading text-base font-semibold">{title}</span>
        </div>
        {actions}
      </div>
      {nav}
    </header>
  );
}
