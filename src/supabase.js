import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://iquxbygkkgwsmrmairei.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxdXhieWdra2d3c21ybWFpcmVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTMwMzYsImV4cCI6MjA5MjY4OTAzNn0.cffL4dimRJCQ2DxiOL-zzcg-tZc9sqLztu6FAEje_Dk'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
