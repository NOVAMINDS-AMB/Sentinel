-- Enable pgcrypto for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2.1. users (references Auth.Users provided by Supabase)
CREATE TABLE public.users (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    timezone TEXT
);

-- 2.2. user_integrations
CREATE TABLE public.user_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    integration_type VARCHAR(50) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    credentials JSONB NOT NULL,
    settings JSONB NOT NULL,
    status VARCHAR(50) NOT NULL,
    last_synced_at TIMESTAMPTZ
);

-- 2.3. notification_metadata
CREATE TABLE public.notification_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    source_id VARCHAR(100) NOT NULL,
    source VARCHAR(50) NOT NULL,
    notification_type VARCHAR(100) NOT NULL,
    sender_domain TEXT,
    received_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ,
    final_score INTEGER,
    action_taken VARCHAR(50),
    retention_until TIMESTAMPTZ
);

-- 2.4. message_excerpts
CREATE TABLE public.message_excerpts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    source_metadata_id UUID REFERENCES public.notification_metadata(id) ON DELETE CASCADE,
    encrypted_excerpt TEXT NOT NULL,
    urgency_score INTEGER,
    sender_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- 2.5. auto_response_drafts
CREATE TABLE public.auto_response_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    notification_id UUID REFERENCES public.notification_metadata(id) ON DELETE CASCADE,
    target_platform VARCHAR(50) NOT NULL,
    encrypted_draft TEXT NOT NULL,
    template_used VARCHAR(100),
    status VARCHAR(50) NOT NULL,
    response_tier INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- 2.6. focus_sessions
CREATE TABLE public.focus_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_minutes INTEGER,
    project_name TEXT,
    focus_score FLOAT,
    notifications_received INTEGER,
    notifications_suppressed INTEGER,
    auto_responses_sent INTEGER,
    retention_until TIMESTAMPTZ
);

-- 3.1. user_context
CREATE TABLE public.user_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    context_type VARCHAR(50) NOT NULL,
    context_id VARCHAR(100) NOT NULL,
    metadata JSONB NOT NULL,
    source VARCHAR(50) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- 4.1. user_oauth_tokens
CREATE TABLE public.user_oauth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    encrypted_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

-- 4.2. audit_logs
CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id),
    action VARCHAR(100) NOT NULL,
    table_name VARCHAR(50),
    record_id UUID,
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address INET,
    succeeded BOOLEAN NOT NULL
);

-- RLS POLICIES
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_excerpts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_response_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own data" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can manage their own integrations" ON public.user_integrations USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own notification metadata" ON public.notification_metadata USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their message excerpts" ON public.message_excerpts USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own drafts" ON public.auto_response_drafts USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their focus sessions" ON public.focus_sessions USING (auth.uid() = user_id);
CREATE POLICY "Users can view their context" ON public.user_context USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their oauth tokens" ON public.user_oauth_tokens USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own audit logs" ON public.audit_logs FOR SELECT USING (auth.uid() = user_id);
