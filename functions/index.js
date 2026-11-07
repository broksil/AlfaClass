const functions = require(`firebase-functions`);

const functions = require('firebase-functions');

exports.fetchTelegramBio = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    const telegramUserId = req.query.telegramUserId;
    const botToken = req.query.botToken || process.env.TELEGRAM_BOT_TOKEN;

    if (!telegramUserId) {
      return res.status(400).json({ success: false, error: 'Missing telegramUserId.' });
    }
    if (!botToken) {
      return res.status(401).json({ success: false, error: 'Missing bot token.' });
    }

    try {
      const url = `https://api.telegram.org/bot${botToken}/getChat?chat_id=${telegramUserId}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text();
        return res.status(400).json({ success: false, error: `Telegram API returned ${response.status}: ${text}` });
      }

      const data = await response.json();
      if (!data.ok) {
        return res.status(400).json({ success: false, error: data.description || 'Telegram API error' });
      }

      const chat = data.result;
      return res.json({
        success: true,
        data: {
          telegramUserId: chat.id,
          firstName: chat.first_name,
          lastName: chat.last_name,
          username: chat.username || null,
          photoUrl: chat.photo_url || null,
          bio: chat.description || '',
          isBot: chat.is_bot || false,
        },
      });
    } catch (err) {
      console.error('fetchTelegramBio error:', err);
      if (err.name === 'AbortError') {
        return res.status(408).json({ success: false, error: 'Request timed out' });
      }
      return res.status(500).json({ success: false, error: err.message || 'Internal error' });
    }
  });
