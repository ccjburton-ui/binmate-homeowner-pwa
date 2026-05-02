// db.js — FmyBins Supabase data layer
// Replaces localStorage with real database operations
// All functions return { data, error } matching Supabase conventions

import { supabase } from './supabase'

// ── Helpers ────────────────────────────────────────────────────────────────────

// Convert snake_case DB row → camelCase app object
function rowToProperty(r) {
  if (!r) return null
  return {
    id:                  r.id,
    type:                r.type,
    address:             r.address,
    unit:                r.unit || '',
    lat:                 r.lat,
    lng:                 r.lng,
    notes:               r.notes || '',
    gate:                r.gate || '',
    driveLong:           r.drive_long || false,
    bins:                r.bins || [],
    pickupWeekday:       r.pickup_weekday || '',
    startDates:          r.start_dates || { recycling: '', fogo: '', glass: '' },
    schedule:            r.schedule || { weekday: r.pickup_weekday, startDates: r.start_dates },
    plan:                r.plan || 'monthly',
    packCredits:         r.pack_credits || 0,
    active:              r.active !== false,
    permanentProviderId: r.permanent_provider_id || null,
    customerName:        r.customer_name || '',
    customerEmail:       r.customer_email || '',
    customerPhone:       r.customer_phone || '',
    opsNotes:            r.ops_notes || '',
    customerId:          r.customer_id || null,
    createdAt:           r.created_at,
  }
}

function propertyToRow(p) {
  return {
    id:                    p.id,
    type:                  p.type,
    address:               p.address,
    unit:                  p.unit || '',
    lat:                   p.lat ?? p.address?.lat ?? null,
    lng:                   p.lng ?? p.address?.lng ?? null,
    notes:                 p.notes || '',
    gate:                  p.gate || '',
    drive_long:            p.driveLong || false,
    bins:                  p.bins || [],
    pickup_weekday:        p.pickupWeekday || '',
    start_dates:           p.startDates || { recycling: '', fogo: '', glass: '' },
    schedule:              p.schedule || null,
    plan:                  p.plan || 'monthly',
    pack_credits:          p.packCredits || 0,
    active:                p.active !== false,
    permanent_provider_id: p.permanentProviderId || null,
    customer_name:         p.customerName || '',
    customer_email:        p.customerEmail || '',
    customer_phone:        p.customerPhone || '',
    ops_notes:             p.opsNotes || '',
    customer_id:           p.customerId || null,
  }
}

function rowToJob(r) {
  if (!r) return null
  return {
    id:            r.id,
    jobKey:        r.job_key,
    weekStartISO:  r.week_start_iso,
    propertyId:    r.property_id,
    providerId:    r.provider_id,
    offeredTo:     r.offered_to,
    type:          r.type,
    binTypes:      r.bin_types || [],
    scheduledFor:  r.scheduled_for,
    status:        r.status || 'unassigned',
    permanent:     r.permanent || false,
    adHoc:         r.ad_hoc || false,
    urgent:        r.urgent || false,
    serviceType:   r.service_type,
    price:         r.price,
    note:          r.note || '',
    offerHistory:  r.offer_history || [],
    allDeclined:   r.all_declined || false,
    photos:        r.photos || [],
    completedAt:   r.completed_at,
  }
}

function jobToRow(j) {
  return {
    id:             j.id,
    job_key:        j.jobKey,
    week_start_iso: j.weekStartISO,
    property_id:    j.propertyId,
    provider_id:    j.providerId || null,
    offered_to:     j.offeredTo || null,
    type:           j.type,
    bin_types:      j.binTypes || [],
    scheduled_for:  j.scheduledFor,
    status:         j.status || 'unassigned',
    permanent:      j.permanent || false,
    ad_hoc:         j.adHoc || false,
    urgent:         j.urgent || false,
    service_type:   j.serviceType || null,
    price:          j.price || null,
    note:           j.note || '',
    offer_history:  j.offerHistory || [],
    all_declined:   j.allDeclined || false,
    photos:         j.photos || [],
    completed_at:   j.completedAt || null,
  }
}

function rowToProvider(r) {
  if (!r) return null
  return {
    id:          r.id,
    name:        r.name,
    username:    r.username,
    password:    r.password,
    phone:       r.phone || '',
    bio:         r.bio || '',
    active:      r.active !== false,
    pending:     r.pending || false,
    serviceArea: r.service_area || null,
    appliedAt:   r.applied_at || null,
  }
}

function providerToRow(p) {
  return {
    id:           p.id,
    name:         p.name,
    username:     p.username,
    password:     p.password,
    phone:        p.phone || '',
    bio:          p.bio || '',
    active:       p.active !== false,
    pending:      p.pending || false,
    service_area: p.serviceArea || null,
    applied_at:   p.appliedAt || null,
  }
}

// ── Properties ─────────────────────────────────────────────────────────────────

export async function fetchProperties() {
  const { data, error } = await supabase.from('properties').select('*').order('created_at')
  return { data: data?.map(rowToProperty) || [], error }
}

export async function upsertProperty(property) {
  const { data, error } = await supabase
    .from('properties').upsert(propertyToRow(property)).select().single()
  return { data: rowToProperty(data), error }
}

export async function deleteProperty(id) {
  const { error } = await supabase.from('properties').delete().eq('id', id)
  return { error }
}

// ── Jobs ───────────────────────────────────────────────────────────────────────

export async function fetchJobs() {
  const { data, error } = await supabase.from('jobs').select('*').order('scheduled_for')
  return { data: data?.map(rowToJob) || [], error }
}

export async function upsertJob(job) {
  const { data, error } = await supabase
    .from('jobs').upsert(jobToRow(job)).select().single()
  return { data: rowToJob(data), error }
}

export async function upsertJobs(jobs) {
  if (!jobs.length) return { data: [], error: null }
  const { data, error } = await supabase
    .from('jobs').upsert(jobs.map(jobToRow)).select()
  return { data: data?.map(rowToJob) || [], error }
}

export async function updateJob(id, updates) {
  // Convert camelCase updates to snake_case
  const row = jobToRow({ id, ...updates })
  const { data, error } = await supabase
    .from('jobs').update(row).eq('id', id).select().single()
  return { data: rowToJob(data), error }
}

export async function deleteOldJobs(cutoffISO) {
  const { error } = await supabase
    .from('jobs').delete().lt('week_start_iso', cutoffISO).eq('status', 'done')
  return { error }
}

// ── Providers ──────────────────────────────────────────────────────────────────

export async function fetchProviders() {
  const { data, error } = await supabase.from('providers').select('*').order('created_at')
  return { data: data?.map(rowToProvider) || [], error }
}

export async function upsertProvider(provider) {
  const { data, error } = await supabase
    .from('providers').upsert(providerToRow(provider)).select().single()
  return { data: rowToProvider(data), error }
}

export async function deleteProvider(id) {
  const { error } = await supabase.from('providers').delete().eq('id', id)
  return { error }
}

// ── Notifications ──────────────────────────────────────────────────────────────

export async function fetchNotifications(propertyIds = []) {
  if (!propertyIds.length) return { data: [], error: null }
  const { data, error } = await supabase
    .from('notifications').select('*')
    .in('property_id', propertyIds)
    .order('created_at', { ascending: false })
    .limit(50)
  return {
    data: data?.map(r => ({
      id: r.id, event: r.event, message: r.message,
      propertyLabel: r.property_label, channel: r.channel,
      read: r.read, timestamp: r.created_at,
    })) || [],
    error,
  }
}

export async function insertNotification(notif, propertyId) {
  const { error } = await supabase.from('notifications').insert({
    id:             notif.id,
    property_id:    propertyId || null,
    event:          notif.event,
    message:        notif.message,
    property_label: notif.propertyLabel || '',
    channel:        notif.channel,
    read:           false,
  })
  return { error }
}

export async function markNotificationsRead(ids) {
  const { error } = await supabase
    .from('notifications').update({ read: true }).in('id', ids)
  return { error }
}

export async function clearNotifications(propertyIds) {
  const { error } = await supabase
    .from('notifications').delete().in('property_id', propertyIds)
  return { error }
}

// ── Provider Notifications ─────────────────────────────────────────────────────

export async function fetchProviderNotifications(providerId) {
  const { data, error } = await supabase
    .from('provider_notifications').select('*')
    .eq('provider_id', providerId)
    .order('created_at', { ascending: false })
    .limit(50)
  return {
    data: data?.map(r => ({
      id: r.id, providerId: r.provider_id, message: r.message,
      emoji: r.emoji, read: r.read, timestamp: r.created_at,
    })) || [],
    error,
  }
}

export async function insertProviderNotification(notif) {
  const { error } = await supabase.from('provider_notifications').insert({
    id:          notif.id,
    provider_id: notif.providerId,
    message:     notif.message,
    emoji:       notif.emoji || '🔔',
    read:        false,
  })
  return { error }
}

export async function clearProviderNotifications(providerId) {
  const { error } = await supabase
    .from('provider_notifications').delete().eq('provider_id', providerId)
  return { error }
}

// ── App Settings ───────────────────────────────────────────────────────────────

export async function fetchSetting(key) {
  const { data, error } = await supabase
    .from('app_settings').select('value').eq('key', key).single()
  return { data: data?.value, error }
}

export async function saveSetting(key, value) {
  const { error } = await supabase
    .from('app_settings').upsert({ key, value })
  return { error }
}
