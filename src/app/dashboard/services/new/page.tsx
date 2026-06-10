"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  createServiceAction,
  type ServiceFormState,
} from "@/app/actions/services";
import { SubmitButton } from "@/components/SubmitButton";
import { SERVICE_TYPE_LABELS, type ServiceType } from "@/lib/types";

const initial: ServiceFormState = {};
const types = Object.keys(SERVICE_TYPE_LABELS) as ServiceType[];

export default function NewServicePage() {
  const [state, formAction] = useActionState(createServiceAction, initial);

  return (
    <div className="max-w-xl">
      <Link href="/dashboard" className="text-sm text-neutral-400 hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-4 text-2xl font-bold">New service</h1>

      <form action={formAction} className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="name">
            Name
          </label>
          <input id="name" name="name" required className="input" />
        </div>

        <div>
          <label className="label" htmlFor="description">
            Description <span className="text-neutral-500">(optional)</span>
          </label>
          <textarea id="description" name="description" rows={3} className="input" />
        </div>

        <div>
          <label className="label" htmlFor="type">
            Type
          </label>
          <select id="type" name="type" className="input" defaultValue="live_browser">
            {types.map((t) => (
              <option key={t} value={t}>
                {SERVICE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="maxParticipants">
            Max participants
          </label>
          <input
            id="maxParticipants"
            name="maxParticipants"
            type="number"
            min={1}
            max={100}
            defaultValue={5}
            className="input"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input type="checkbox" name="isPublic" className="h-4 w-4" />
          Make this service publicly discoverable
        </label>

        {state.error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {state.error}
          </p>
        )}

        <SubmitButton className="btn-primary">Create service</SubmitButton>
      </form>
    </div>
  );
}
