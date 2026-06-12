import { ChevronDown, Laptop, Moon, Palette, Sparkles, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/app/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/app/shared/components/ui/dropdown-menu";

const themes = [
  { value: "system", label: "System", icon: Laptop },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "leeku", label: "Leeku", icon: Sparkles },
] as const;

export default function ThemeSettings() {
  const { theme = "system", setTheme } = useTheme();
  const selectedTheme =
    themes.find((option) => option.value === theme) ?? themes[0];
  const SelectedIcon = selectedTheme.icon;

  return (
    <section className="mt-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-6 shadow-[var(--shadow-hairline)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            <h2 className="text-sm font-semibold">Appearance</h2>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Choose a theme or match your device settings.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-36 justify-between"
            >
              <span className="flex items-center gap-2">
                <SelectedIcon className="h-3.5 w-3.5" />
                {selectedTheme.label}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              {themes.map((option) => {
                const Icon = option.icon;
                return (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    <Icon />
                    {option.label}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </section>
  );
}
