import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ProviderModelSchema } from "@conductor/core";
import type { ProviderModelRow } from "@conductor/core";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UpdateModelBodySchema = z.object({
  displayName: z.string().min(1).optional(),
  capabilities: z.record(z.unknown()).optional(),
  available: z.boolean().optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Model ID is required" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsedBody = UpdateModelBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsedBody.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    // Check if model exists first
    // why: Supabase client typing resolves table rows to never in this setup, so we cast to the known DB row types
    const { data: existing, error: findError } = (await supabase
      .from("provider_models")
      .select("id")
      .eq("id", id)
      .maybeSingle()) as unknown as { data: { id: string } | null; error: { message: string } | null };

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    // Map body to snake_case for DB update
    const updatePayload: Partial<
      Omit<ProviderModelRow, "id" | "provider" | "model_id" | "created_at">
    > = {};
    if (parsedBody.data.displayName !== undefined) updatePayload.display_name = parsedBody.data.displayName;
    if (parsedBody.data.capabilities !== undefined) updatePayload.capabilities = parsedBody.data.capabilities;
    if (parsedBody.data.available !== undefined) updatePayload.available = parsedBody.data.available;

    // why: Supabase client typing resolves table rows to never in this setup, so we cast the builder to any to allow updating and cast the result to the known DB row types
    const { data: updatedData, error: updateError } = (await (supabase
      .from("provider_models") as any)
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single()) as unknown as { data: ProviderModelRow | null; error: { message: string } | null };

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (!updatedData) {
      return NextResponse.json({ error: "Failed to update model" }, { status: 500 });
    }

    // Map to camelCase and validate
    const mapped = {
      id: updatedData.id,
      provider: updatedData.provider,
      modelId: updatedData.model_id,
      displayName: updatedData.display_name,
      capabilities: (updatedData.capabilities && typeof updatedData.capabilities === "object" ? updatedData.capabilities : {}) as Record<string, unknown>,
      available: updatedData.available,
      createdAt: updatedData.created_at,
    };

    const validated = ProviderModelSchema.parse(mapped);
    return NextResponse.json({ model: validated });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Model ID is required" }, { status: 400 });
  }

  try {
    // Check if model exists first
    // why: Supabase client typing resolves table rows to never in this setup, so we cast to the known DB row types
    const { data: existing, error: findError } = (await supabase
      .from("provider_models")
      .select("id")
      .eq("id", id)
      .maybeSingle()) as unknown as { data: { id: string } | null; error: { message: string } | null };

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    // why: Supabase client typing resolves table rows to never in this setup, so we cast the builder to any to allow updating and cast the result to the known DB row types
    const { error: deleteError } = (await (supabase
      .from("provider_models") as any)
      .delete()
      .eq("id", id)) as unknown as { error: { message: string } | null };

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
