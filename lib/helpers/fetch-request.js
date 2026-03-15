'use strict';

async function fetchRequest(options) {
  const {
    url,
    method = 'GET',
    headers,
    json = false,
    form,
    body,
    timeout = 10000
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    let requestBody = body;
    const requestHeaders = { ...headers };

    if (form) {
      requestBody = new URLSearchParams(form).toString();
      if (!requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal
    });

    if (!response.ok) {
      const responseBody = await response.text();
      const error = new Error(`Request failed with status ${response.status} for ${url}`);
      error.status = response.status;
      error.body = responseBody;
      throw error;
    }

    if (json) {
      return response.json();
    }

    return response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = fetchRequest;
