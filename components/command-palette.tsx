"use client"

import { useEffect, useState } from "react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Search, Plus, Settings, Users, BarChart3, LogOut, Moon } from "lucide-react"

interface CommandPaletteProps {
  onNavigate?: (path: string) => void
  onAction?: (action: string) => void
}

export function CommandPalette({ onNavigate, onAction }: CommandPaletteProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    const handleOpen = () => setOpen(true)

    document.addEventListener("keydown", down)
    window.addEventListener("open-command-palette", handleOpen)

    return () => {
      document.removeEventListener("keydown", down)
      window.removeEventListener("open-command-palette", handleOpen)
    }
  }, [])

  const runCommand = (command: () => void) => {
    setOpen(false)
    command()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => runCommand(() => onAction?.("new-subscription"))}>
            <Plus className="mr-2 h-4 w-4" />
            <span>New Subscription</span>
            <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
              <span className="text-xs">⌘</span>N
            </kbd>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => onAction?.("search"))}>
            <Search className="mr-2 h-4 w-4" />
            <span>Search Subscriptions</span>
            <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
              /
            </kbd>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => runCommand(() => onNavigate?.("/dashboard"))}>
            <BarChart3 className="mr-2 h-4 w-4" />
            <span>Dashboard</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => onNavigate?.("/analytics"))}>
            <BarChart3 className="mr-2 h-4 w-4" />
            <span>Analytics</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => onNavigate?.("/teams"))}>
            <Users className="mr-2 h-4 w-4" />
            <span>Teams</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => onNavigate?.("/settings"))}>
            <Settings className="mr-2 h-4 w-4" />
            <span>Settings</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Preferences">
          <CommandItem onSelect={() => runCommand(() => onAction?.("toggle-theme"))}>
            <Moon className="mr-2 h-4 w-4" />
            <span>Toggle Dark Mode</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => onAction?.("sign-out"))}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Sign Out</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
