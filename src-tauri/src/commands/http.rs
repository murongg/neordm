use crate::models::{HttpProxyHeaderOutput, HttpProxyRequestInput, HttpProxyResponse};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    Client, Method,
};

fn build_header_map(input: &HttpProxyRequestInput) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();

    for header in &input.headers {
        let name = HeaderName::from_bytes(header.name.as_bytes())
            .map_err(|error| format!("Invalid header name '{}': {error}", header.name))?;
        let value = HeaderValue::from_str(&header.value)
            .map_err(|error| format!("Invalid header value for '{}': {error}", header.name))?;

        headers.append(name, value);
    }

    Ok(headers)
}

#[tauri::command]
pub async fn proxy_http_request(input: HttpProxyRequestInput) -> Result<HttpProxyResponse, String> {
    let parsed_url = url::Url::parse(&input.url)
        .map_err(|error| format!("Invalid proxy URL '{}': {error}", input.url))?;

    match parsed_url.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(format!(
                "Unsupported proxy URL scheme '{scheme}'. Only http and https are allowed."
            ))
        }
    }

    let method = Method::from_bytes(input.method.as_bytes())
        .map_err(|error| format!("Invalid HTTP method '{}': {error}", input.method))?;
    let headers = build_header_map(&input)?;
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {error}"))?;

    let mut request = client.request(method, parsed_url).headers(headers);

    if let Some(body) = input.body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("HTTP proxy request failed: {error}"))?;

    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or_default().to_string();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| HttpProxyHeaderOutput {
            name: name.to_string(),
            value: value.to_str().unwrap_or_default().to_string(),
        })
        .collect();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read HTTP proxy response: {error}"))?;

    Ok(HttpProxyResponse {
        status: status.as_u16(),
        status_text,
        headers,
        body,
    })
}
