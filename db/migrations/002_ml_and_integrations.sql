-- ML User Profiles: stores learned weights per user
CREATE TABLE public.user_ml_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
    role TEXT NOT NULL DEFAULT 'professional',
    sender_weights JSONB NOT NULL DEFAULT '{}',
    keyword_weights JSONB NOT NULL DEFAULT '{}',
    source_weights JSONB NOT NULL DEFAULT '{"email": 1.0, "whatsapp": 1.0, "linkedin": 1.0}',
    time_weights JSONB NOT NULL DEFAULT '{"morning": 1.0, "afternoon": 1.0, "evening": 1.0}',
    vip_senders TEXT[] NOT NULL DEFAULT '{}',
    blocked_senders TEXT[] NOT NULL DEFAULT '{}',
    focus_keywords TEXT[] NOT NULL DEFAULT '{}',
    total_interactions INTEGER NOT NULL DEFAULT 0,
    correct_predictions INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notification Feedback: user corrections that train the ML model
CREATE TABLE public.notification_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    notification_id UUID REFERENCES public.notification_metadata(id) ON DELETE SET NULL,
    ai_score FLOAT NOT NULL,
    final_score FLOAT NOT NULL,
    rating TEXT NOT NULL, -- 'correct' | 'too_high' | 'too_low' | 'vip_add' | 'block_sender'
    sender TEXT,
    source TEXT,
    keywords TEXT[],
    response_time_seconds INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Onboarding: initial context profile filled at first login
CREATE TABLE public.user_onboarding (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT,
    vip_senders TEXT[] DEFAULT '{}',
    focus_keywords TEXT[] DEFAULT '{}',
    focus_hours_start INTEGER DEFAULT 9,
    focus_hours_end INTEGER DEFAULT 17,
    auto_reply_enabled BOOLEAN DEFAULT TRUE,
    auto_reply_confidence_threshold FLOAT DEFAULT 0.7,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE public.user_ml_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own ml profile" ON public.user_ml_profile USING (auth.uid() = user_id);
CREATE POLICY "Users manage own feedback" ON public.notification_feedback USING (auth.uid() = user_id);
CREATE POLICY "Users manage own onboarding" ON public.user_onboarding USING (auth.uid() = user_id);
