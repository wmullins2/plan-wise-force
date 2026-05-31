
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'viewer');
CREATE TYPE public.contract_type AS ENUM ('TFM','Hard FM','Soft FM','Self-delivered');
CREATE TYPE public.operating_pattern AS ENUM ('Mon-Fri 08-17','Mon-Sat 08-17','Extended 07-19 Mon-Fri','24/7 continuous','24/5 Mon-Fri','Custom');
CREATE TYPE public.shift_model AS ENUM ('Day work','Continental 4on4off 12h','3-shift rotating 8h','2-shift early/late 8h','Custom');
CREATE TYPE public.discipline AS ENUM ('HVAC','Electrical','Plumbing','BMS','Fabric','Supervisor','General');
CREATE TYPE public.wo_type AS ENUM ('PM','Inspection','Statutory','Recurring');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  last_login_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Has role helper (security definer)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)
$$;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid()
  ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END LIMIT 1
$$;

-- Sites
CREATE TABLE public.sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  contract_type contract_type NOT NULL DEFAULT 'TFM',
  reactive_hours_per_year NUMERIC NOT NULL DEFAULT 0,
  operating_pattern operating_pattern NOT NULL DEFAULT 'Mon-Fri 08-17',
  shift_model shift_model NOT NULL DEFAULT 'Day work',
  hours_per_shift NUMERIC NOT NULL DEFAULT 9,
  concurrent_shifts INT NOT NULL DEFAULT 1,
  work_days_per_year INT NOT NULL DEFAULT 252,
  min_on_site INT NOT NULL DEFAULT 1,
  annual_leave_days INT NOT NULL DEFAULT 28,
  sickness_days INT NOT NULL DEFAULT 5,
  training_days INT NOT NULL DEFAULT 5,
  -- 12 wrench time factors (hrs)
  wt_travel NUMERIC NOT NULL DEFAULT 0.75,
  wt_idle NUMERIC NOT NULL DEFAULT 0.25,
  wt_permits NUMERIC NOT NULL DEFAULT 0.10,
  wt_parts NUMERIC NOT NULL DEFAULT 0.15,
  wt_coordination NUMERIC NOT NULL DEFAULT 0.50,
  wt_meetings NUMERIC NOT NULL DEFAULT 0.30,
  wt_setup NUMERIC NOT NULL DEFAULT 0.50,
  wt_cleanup NUMERIC NOT NULL DEFAULT 0.50,
  wt_breakin NUMERIC NOT NULL DEFAULT 0.00,
  wt_training NUMERIC NOT NULL DEFAULT 0.25,
  wt_escorting NUMERIC NOT NULL DEFAULT 0.30,
  wt_admin NUMERIC NOT NULL DEFAULT 0.75,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites TO authenticated;
GRANT ALL ON public.sites TO service_role;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

-- Site access (for restricting editors/viewers)
CREATE TABLE public.site_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  UNIQUE(user_id, site_id)
);
GRANT SELECT, INSERT, DELETE ON public.site_access TO authenticated;
GRANT ALL ON public.site_access TO service_role;
ALTER TABLE public.site_access ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_site(_site_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(auth.uid(),'admin')
    OR EXISTS (SELECT 1 FROM public.sites WHERE id=_site_id AND owner_id=auth.uid())
    OR EXISTS (SELECT 1 FROM public.site_access WHERE site_id=_site_id AND user_id=auth.uid())
$$;

-- PM tasks
CREATE TABLE public.pm_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  task_name TEXT NOT NULL,
  in_house BOOLEAN NOT NULL DEFAULT true,
  wo_type wo_type NOT NULL DEFAULT 'PM',
  discipline discipline NOT NULL DEFAULT 'General',
  statutory BOOLEAN NOT NULL DEFAULT false,
  num_assets NUMERIC NOT NULL DEFAULT 1,
  mins_per_asset NUMERIC NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'Annual',
  periodicity_multiplier NUMERIC NOT NULL DEFAULT 1,
  hours_per_year NUMERIC NOT NULL DEFAULT 0,
  sfg20_code TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pm_tasks TO authenticated;
GRANT ALL ON public.pm_tasks TO service_role;
ALTER TABLE public.pm_tasks ENABLE ROW LEVEL SECURITY;

-- Policies
-- profiles: user can see/update self; admins see all
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles insert self" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- user_roles: self read, admin manages via service role
CREATE POLICY "roles self read" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- sites: admin all, editor/viewer only their assigned/owned sites
CREATE POLICY "sites read" ON public.sites FOR SELECT TO authenticated
  USING (public.can_access_site(id));
CREATE POLICY "sites insert editor+" ON public.sites FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor'));
CREATE POLICY "sites update editor+" ON public.sites FOR UPDATE TO authenticated
  USING ((public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')) AND public.can_access_site(id));
CREATE POLICY "sites delete admin" ON public.sites FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- site_access: admin only
CREATE POLICY "site_access read" ON public.site_access FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "site_access write admin" ON public.site_access FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "site_access del admin" ON public.site_access FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- pm_tasks: editors+ can write to sites they can access
CREATE POLICY "tasks read" ON public.pm_tasks FOR SELECT TO authenticated
  USING (public.can_access_site(site_id));
CREATE POLICY "tasks insert editor+" ON public.pm_tasks FOR INSERT TO authenticated
  WITH CHECK ((public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')) AND public.can_access_site(site_id));
CREATE POLICY "tasks update editor+" ON public.pm_tasks FOR UPDATE TO authenticated
  USING ((public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')) AND public.can_access_site(site_id));
CREATE POLICY "tasks delete editor+" ON public.pm_tasks FOR DELETE TO authenticated
  USING ((public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')) AND public.can_access_site(site_id));

-- Auto-create profile + assign first user as admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count INT;
  assigned_role app_role;
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name',''), NEW.email);

  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  IF user_count = 0 THEN
    assigned_role := 'admin';
  ELSE
    assigned_role := COALESCE((NEW.raw_user_meta_data->>'role')::app_role, 'viewer');
  END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, assigned_role);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update last_login trigger via RPC
CREATE OR REPLACE FUNCTION public.update_last_login()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.profiles SET last_login_at = now() WHERE id = auth.uid()
$$;
GRANT EXECUTE ON FUNCTION public.update_last_login() TO authenticated;
