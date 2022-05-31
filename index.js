import { DOMAIN, REPOSITORY, DEFAULT_TAG, SITE_NAME, GITHUB_TOKEN, HTTP_AUTH, USERNAME, PASSWORD } from "./config";
import { listFilesHTML, listReleasesHTML, createHTMLResponse } from "./ui";

addEventListener("fetch", (event) => event.respondWith(fetchEventHandler(event)));

/**
 * Break down base64 encoded authorization string into plain-text username and password
 * @param {string} authorization
 * @returns {string[]}
 */
function parseCredentials(authorization) {
  const parts = authorization.split(' ')
  const plainAuth = atob(parts[1])
  const credentials = plainAuth.split(':')
  return credentials
}

/**
 * Helper funtion to generate Response object
 * @param {string} message
 * @returns {Response}
 */
function getUnauthorizedResponse(message) {
  let response = new Response(message, {
    status: 401,
  })
  response.headers.set('WWW-Authenticate', `Basic realm="index"`)
  return response
}

async function fetchEventHandler(event) {
  const request = event.request;
  let url = new URL(request.url);
  if (typeof DOMAIN !== "undefined" && url.hostname !== DOMAIN) {
    return createHTMLResponse(400, "Bad Request");
  }
  if (url.pathname === "/robots.txt") {
    return new Response("User-Agent: *\nDisallow: /\n", { status: 200, headers: { "Content-Type": "text/plain" }})
  }

  if (typeof GITHUB_TOKEN == "undefined") {
    config = { "User-Agent": `Repository ${REPOSITORY}` }
  } else {
    config = { "Authorization": `token ${GITHUB_TOKEN}`, "User-Agent": `Repository ${REPOSITORY}` }
  }

  let newUrl, tag, filename;
  let pathParts = url.pathname.split("/");
  if (pathParts.length === 2) {
    if (HTTP_AUTH) {
      const authorization = request.headers.get('authorization')
      if (!request.headers.has('authorization')) {
        return getUnauthorizedResponse(
          'Provide User Name and Password to access this page.',
        )
      }
      const credentials = parseCredentials(authorization)
      if (credentials[0] !== USERNAME || credentials[1] !== PASSWORD) {
        return getUnauthorizedResponse(
          'The User Name and Password combination you have entered is invalid.',
        )
      }
    }

    if (pathParts[1] === "") {
      // Front page - list available releases
      let apiUrl = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`;
      console.log(apiUrl);
      let response = await fetch(apiUrl, { headers: config });
      if (response.status !== 200) {
        console.log(response.status);
        console.log(response.body.read());
        return createHTMLResponse(503, "Unavailable");
      }
      let data = await response.json();
      let respHeaders = new Headers({ "Content-Type": "text-html" });
      for (let p of response.headers) {
        if (p[0].toLowerCase().startsWith("x-ratelimit-")) {
          respHeaders.set(p[0], p[1]);
        }
      }
      return new Response(listReleasesHTML(data), { status: 200, headers: respHeaders });
    }

    // One slash - load file from DEFAULT_TAG
    tag = DEFAULT_TAG;
    filename = pathParts[1];
  } else if (pathParts.length === 3) {
    // Two slashes
    tag = pathParts[1];
    if (pathParts[2] === "") {
      // Fetch GitHub API and list files
      let apiUrl = `https://api.github.com/repos/${REPOSITORY}/releases/tags/${tag}`;
      console.log(apiUrl);
      let response = await fetch(apiUrl, { headers: config });
      if (response.status !== 200) {
        console.log(response.status);
        console.log(response.body.read());
        return createHTMLResponse(503, "Unavailable");
      }
      let data = await response.json();
      if (request.method === "POST") {
        // Return the upload URL in JSON
        response = { upload_url: data["upload_url"].split("{")[0] };
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      let respHeaders = new Headers({ "Content-Type": "text-html" });
      for (let p of response.headers) {
        if (p[0].toLowerCase().startsWith("x-ratelimit-")) {
          respHeaders.set(p[0], p[1]);
        }
      }
      return new Response(listFilesHTML(REPOSITORY, data), { status: 200, headers: respHeaders });
    }
    filename = pathParts[pathParts.length - 1];
  } else {
    return createHTMLResponse(400, "Bad Request");
  }

  // Default action: Download file
  newUrl = `https://github.com/${REPOSITORY}/releases/download/${tag}/${filename}`;
  let response = await fetch(newUrl, { method: request.method });
  if (response.status !== 200) {
    return createHTMLResponse(404, "Not Found");
  }
  let { readable, writable } = new TransformStream();
  return new Response(response.body, response);
}
