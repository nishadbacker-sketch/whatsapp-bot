async function getShopifyAccessToken() {
    const rawDomain = process.env.SHOPIFY_STORE_DOMAIN || 'shopex2.myshopify.com';
    const storeDomain = rawDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET");
    }

    const response = await axios.post(
        `https://${storeDomain}/admin/oauth/access_token`,
        {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials'
        },
        {
            headers: { 'Content-Type': 'application/json' }
        }
    );

    return response.data.access_token;
}

async function getShopifyOrderStatus(orderNumberClean) {
    const rawDomain = process.env.SHOPIFY_STORE_DOMAIN || 'shopex2.myshopify.com';
    const storeDomain = rawDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    try {
        const accessToken = await getShopifyAccessToken();

        const response = await axios.get(
            `https://${storeDomain}/admin/api/2024-07/orders.json?name=%23${orderNumberClean}&status=any`,
            {
                headers: {
                    'X-Shopify-Access-Token': accessToken,
                    'Content-Type': 'application/json'
                }
            }
        );

        let orders = response.data.orders;

        if (!orders || orders.length === 0) {
            const fallbackResponse = await axios.get(
                `https://${storeDomain}/admin/api/2024-07/orders.json?name=${orderNumberClean}&status=any`,
                {
                    headers: {
                        'X-Shopify-Access-Token': accessToken,
                        'Content-Type': 'application/json'
                    }
                }
            );
            orders = fallbackResponse.data.orders;
        }

        if (!orders || orders.length === 0) {
            return `❌ Order #${orderNumberClean} was not found. Please double-check your order number and try again.`;
        }

        const order = orders[0];
        const financialStatus = order.financial_status ? order.financial_status.toUpperCase() : 'N/A';
        const fulfillmentStatus = order.fulfillment_status ? order.fulfillment_status.toUpperCase() : 'UNFULFILLED';
        const trackingUrl = order.fulfillments?.[0]?.tracking_url || null;

        let statusMessage = 
            `📦 *Order Details for #${orderNumberClean}*\n\n` +
            `🔹 *Payment Status:* ${financialStatus}\n` +
            `🔹 *Fulfillment Status:* ${fulfillmentStatus}\n` +
            `🔹 *Total Amount:* ₹${order.total_price}\n`;

        if (trackingUrl) {
            statusMessage += `\n🚚 *Track Your Package:* ${trackingUrl}`;
        } else {
            statusMessage += `\n⏳ Your order is being processed for dispatch. Tracking details will update soon!`;
        }

        return statusMessage;

    } catch (error) {
        console.error('Shopify API Error Status:', error?.response?.status);
        console.error('Shopify API Error Details:', JSON.stringify(error?.response?.data || error.message));
        return "⚠️ Unable to fetch order status right now. Please check credentials or permissions.";
    }
}
