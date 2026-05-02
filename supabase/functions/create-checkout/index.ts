import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const PRICE_IDS: Record<string, string> = {
  monthly:  "price_1TSZwOFizOz6xdHq9Toa9uMz",
  pack:     "price_1TSZy8FizOz6xdHqNluKJ7Ar",
  once_off: "price_1TSZzOFizOz6xdHq0GLfLqdn",
  urgent:   "price_1TSa1IFizOz6xdHqRgPfgHF5",
};

const DRIVEWAY_PRICE_IDS: Record<string, string> = {
  monthly:  "price_1TSaZIFizOz6xdHqSGRLxmBD",
  once_off: "price_1TSaZeFizOz6xdHqjFxRE4nm",
  urgent:   "price_1TSaZeFizOz6xdHqjFxRE4nm",
  pack:     "price_1TSacwFizOz6xdHqYGEg5Ssc",
};

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { plan, propertyId, driveLong, successUrl, cancelUrl } = await req.json();

    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      return new Response(
        JSON.stringify({ error: `Unknown plan: ${plan}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isMonthly = plan === "monthly";

    const lineItems = [{ price: priceId, quantity: 1 }];
    if (driveLong && DRIVEWAY_PRICE_IDS[plan]) {
      lineItems.push({ price: DRIVEWAY_PRICE_IDS[plan], quantity: 1 });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items:           lineItems,
      mode:                 isMonthly ? "subscription" : "payment",
      success_url:          `${successUrl}?session_id={CHECKOUT_SESSION_ID}&plan=${plan}&property_id=${propertyId}`,
      cancel_url:           cancelUrl,
      metadata: {
        plan,
        property_id: propertyId ?? "",
        drive_long:  driveLong ? "true" : "false",
      },
    });

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Stripe error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
