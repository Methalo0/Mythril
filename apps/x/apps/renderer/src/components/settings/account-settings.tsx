"use client"

import { User } from "lucide-react"

interface AccountSettingsProps {
  dialogOpen: boolean
}

/**
 * Mythril has no accounts — everything runs locally on your own API keys.
 * This tab stays as a placeholder so the settings nav has somewhere stable
 * to land; the Mythril account/billing UI was removed with the hosted
 * gateway.
 */
export function AccountSettings(_props: AccountSettingsProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <User className="size-7 text-muted-foreground" />
      </div>
      <div className="text-center space-y-1 max-w-sm">
        <p className="text-sm font-medium">No account needed</p>
        <p className="text-xs text-muted-foreground">
          Mythril is fully local — all features work with your own API keys and nothing is gated behind a sign-in.
        </p>
      </div>
    </div>
  )
}
