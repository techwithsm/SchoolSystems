'use server';

import { redirect } from 'next/navigation';
import { createUserClient } from '@/lib/supabase/server';

export type SignInState = { error: string | null };

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: 'Sign-in failed. Check your email and password.' };

  redirect('/admin');
}
