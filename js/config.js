export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const ACCESS_PASSWORD = import.meta.env.VITE_ACCESS_PASSWORD;

// Hugging Face Credentials
export const HF_TOKEN = import.meta.env.VITE_HF_TOKEN;

// Raw repo ID from env (e.g. "Anoderb/dataset-collect")
const _rawHfRepo = import.meta.env.VITE_HF_REPO || '';

// HF_REPO_ID: clean repo id tanpa prefix, untuk konstruksi URL
// (e.g. "Anoderb/dataset-collect")
export const HF_REPO_ID = _rawHfRepo.startsWith('datasets/')
  ? _rawHfRepo.slice('datasets/'.length)
  : _rawHfRepo;

// HF_REPO: repo string dengan prefix 'datasets/' untuk @huggingface/hub SDK
// Library v2 menentukan tipe repo dari prefix string, bukan dari parameter repoType
export const HF_REPO = _rawHfRepo
  ? (_rawHfRepo.startsWith('datasets/') ? _rawHfRepo : `datasets/${_rawHfRepo}`)
  : '';


if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("your-supabase-project") || SUPABASE_ANON_KEY.includes("your-supabase-anon")) {
  console.warn(
    "Supabase credentials are using placeholder values. Please update your .env file with actual credentials."
  );
}

