import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe } from "@/lib/stripe";
import { useServerFn } from "@tanstack/react-start";
import { createCheckoutSession } from "@/lib/payments.functions";
import { useCallback } from "react";

type PriceKey =
  | "god_mode_weekly"
  | "hint_pack_5"
  | "poll_reveal_one"
  | "weekend_boost_one"
  | "match_save_one";

export function StripeEmbeddedCheckoutInline(props: {
  priceId: PriceKey;
  returnTo: "shop" | "upgrade";
  metaMatchId?: string;
}) {
  const create = useServerFn(createCheckoutSession);
  const fetchClientSecret = useCallback(async () => {
    const r = await create({
      data: {
        priceId: props.priceId,
        returnTo: props.returnTo,
        metaMatchId: props.metaMatchId,
      },
    });
    if ("error" in r) throw new Error(r.error);
    return r.clientSecret;
  }, [create, props.priceId, props.returnTo, props.metaMatchId]);

  return (
    <div id="checkout" className="w-full">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
