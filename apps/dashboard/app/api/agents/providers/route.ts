import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ProviderModelSchema } from "@conductor/core";
import type { ProviderModelRow } from "@conductor/core";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  claude: "Claude",
  opencode: "OpenCode",
};

const CreateModelBodySchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  capabilities: z.record(z.unknown()).default({}),
});

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const includeAll = searchParams.get("all") === "true";

  try {
    let query = supabase.from("provider_models").select("*");
    if (!includeAll) {
      query = query.eq("available", true);
    }

    // why: Supabase client typing resolves table rows to never in this setup, so we cast to the known DB row types
    const { data: modelsData, error: modelsError } = (await query) as unknown as {
      data: ProviderModelRow[] | null;
      error: { message: string } | null;
    };

    if (modelsError) {
      return NextResponse.json({ error: modelsError.message }, { status: 500 });
    }

    const rows = modelsData || [];

    // Map and validate each row using ProviderModelSchema
    const mappedModels = rows.map((row) => {
      let capabilities: Record<string, unknown> = {};
      if (
        row.capabilities &&
        typeof row.capabilities === "object" &&
        !Array.isArray(row.capabilities)
      ) {
        capabilities = row.capabilities as Record<string, unknown>;
      }

      const mapped = {
        id: row.id,
        provider: row.provider,
        modelId: row.model_id,
        displayName: row.display_name,
        capabilities,
        available: row.available,
        createdAt: row.created_at,
      };

      return ProviderModelSchema.parse(mapped);
    });

    // Group by provider
    const groups: Record<string, typeof mappedModels> = {};
    for (const model of mappedModels) {
      const provider = model.provider;
      let list = groups[provider];
      if (!list) {
        list = [];
        groups[provider] = list;
      }
      list.push(model);
    }

    const providers = Object.entries(groups).map(([providerName, models]) => {
      return {
        name: providerName,
        displayName:
          PROVIDER_DISPLAY_NAMES[providerName] ||
          providerName.charAt(0).toUpperCase() + providerName.slice(1),
        models,
      };
    });

    return NextResponse.json({ providers, rawModels: mappedModels });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsedBody = CreateModelBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsedBody.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { provider, modelId, displayName, capabilities } = parsedBody.data;

  try {
    // Check if model already exists for provider
    // why: Supabase client typing resolves table rows to never in this setup, so we cast to the known DB row types
    const { data: existing, error: findError } = (await supabase
      .from("provider_models")
      .select("id")
      .eq("provider", provider)
      .eq("model_id", modelId)
      .maybeSingle()) as unknown as { data: { id: string } | null; error: { message: string } | null };

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    if (existing) {
      return NextResponse.json(
        { error: `Model '${modelId}' already exists for provider '${provider}'` },
        { status: 409 }
      );
    }

    // Insert new model row (stored as snake_case)
    const payload = {
      provider,
      model_id: modelId,
      display_name: displayName,
      capabilities,
      available: true,
    };

    // why: Supabase client typing resolves table rows to never in this setup, so we cast the builder to any to allow updating and cast the result to the known DB row types
    const { data: inserted, error: insertError } = (await (supabase
      .from("provider_models") as unknown as { insert: (p: unknown) => { select: () => { single: () => Promise<unknown> } } })
      .insert(payload)
      .select()
      .single()) as unknown as { data: ProviderModelRow | null; error: { message: string } | null };

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    if (!inserted) {
      return NextResponse.json({ error: "Failed to create provider model" }, { status: 500 });
    }

    // Map to camelCase and validate
    const mapped = {
      id: inserted.id,
      provider: inserted.provider,
      modelId: inserted.model_id,
      displayName: inserted.display_name,
      capabilities: (inserted.capabilities && typeof inserted.capabilities === "object" ? inserted.capabilities : {}) as Record<string, unknown>,
      available: inserted.available,
      createdAt: inserted.created_at,
    };

    const validated = ProviderModelSchema.parse(mapped);
    return NextResponse.json({ model: validated }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
