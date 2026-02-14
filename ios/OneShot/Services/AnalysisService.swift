import Foundation
import UIKit

class AnalysisService {
    static let shared = AnalysisService()

    private var apiKey: String?
    private var model: String = "google/gemini-2.0-flash-001"

    private init() {}

    // MARK: - Config

    func loadConfig() async throws {
        let config: ConfigResponse = try await APIService.shared.get(path: "/api/config")
        self.apiKey = config.openRouterApiKey
        if let m = config.analysisModel {
            self.model = m
        }
    }

    // MARK: - Analyze a single screenshot

    func analyzeScreenshot(_ image: UIImage) async throws -> [ExtractedItem] {
        guard let apiKey = apiKey else {
            throw AnalysisError.noApiKey
        }

        guard let jpegData = image.jpegData(compressionQuality: 0.7) else {
            throw AnalysisError.imageConversionFailed
        }

        let base64 = jpegData.base64EncodedString()
        let dataUrl = "data:image/jpeg;base64,\(base64)"

        let today = Date().formatted(.dateTime.weekday(.wide).month(.wide).day().year())

        let systemPrompt = """
        You are an assistant that extracts actionable scheduling information from screenshots. \
        These screenshots come from busy parents who deal with kids sports, school, \
        family activities, work, social events, etc.

        FIRST: Decide if this screenshot contains actionable life-admin information — things like:
        - Event schedules, game times, practice times
        - Deadlines (registration, payments, forms due)
        - Action items (bring snacks, buy gear, RSVP, sign up)
        - Important announcements about schedule changes
        - Texts/emails/notifications about specific upcoming events or tasks

        If the screenshot is NOT relevant (memes, social media browsing, app store, \
        general web browsing, news articles, photos, games, entertainment, settings screens, \
        or anything that does NOT contain a specific event, deadline, or task), \
        return an empty array: []

        If the screenshot IS relevant, extract actionable items. For each item, return a JSON object with:
        - "type": one of "event", "deadline", "action", "info"
        - "title": short clear title
        - "date": ISO date string if known, or null
        - "time": time string if known (e.g. "3:30 PM"), or null
        - "endTime": end time if known, or null
        - "location": location if mentioned, or null
        - "description": 1-2 sentence summary of the key details
        - "urgency": "high" (within 48h or overdue), "medium" (this week), "low" (future/no rush)
        - "category": one of "sports", "school", "work", "social", "health", "finance", "family", "other"
        - "people": array of names mentioned, or []
        - "rawText": key verbatim text from the screenshot that supports this item

        IMPORTANT:
        - Only extract items that have a SPECIFIC event, deadline, task, or scheduling detail.
        - Do NOT extract vague or general information. If there's no clear "what + when" or "what to do", skip it.
        - If dates are relative ("this Saturday", "tomorrow"), resolve them. Today is \(today).
        - If you can't determine urgency precisely, default to "medium".
        - When in doubt, return []. Fewer high-quality cards is better than many irrelevant ones.

        Return ONLY a JSON array of items. No markdown, no explanation. Just the array.
        """

        let requestBody: [String: Any] = [
            "model": model,
            "messages": [
                [
                    "role": "system",
                    "content": systemPrompt,
                ],
                [
                    "role": "user",
                    "content": [
                        [
                            "type": "image_url",
                            "image_url": ["url": dataUrl],
                        ],
                        [
                            "type": "text",
                            "text": "Extract all actionable information from this screenshot.",
                        ],
                    ],
                ],
            ],
            "temperature": 0.1,
            "max_tokens": 4000,
        ]

        var request = URLRequest(url: URL(string: "https://openrouter.ai/api/v1/chat/completions")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: requestBody)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? "Unknown"
            throw AnalysisError.apiError(body)
        }

        // Parse the OpenRouter response
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = json["choices"] as? [[String: Any]],
              let message = choices.first?["message"] as? [String: Any],
              let content = message["content"] as? String else {
            throw AnalysisError.parseError
        }

        // Clean up response (strip markdown code fences if present)
        var cleaned = content.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.hasPrefix("```") {
            cleaned = cleaned
                .replacingOccurrences(of: "^```(?:json)?\\n?", with: "", options: .regularExpression)
                .replacingOccurrences(of: "\\n?```$", with: "", options: .regularExpression)
        }

        guard let itemsData = cleaned.data(using: .utf8) else {
            throw AnalysisError.parseError
        }

        let decoder = JSONDecoder()
        return try decoder.decode([ExtractedItem].self, from: itemsData)
    }
}

enum AnalysisError: LocalizedError {
    case noApiKey
    case imageConversionFailed
    case apiError(String)
    case parseError

    var errorDescription: String? {
        switch self {
        case .noApiKey:
            return "No API key available. Please try again."
        case .imageConversionFailed:
            return "Failed to convert screenshot for analysis."
        case .apiError(let msg):
            return "Analysis API error: \(msg)"
        case .parseError:
            return "Failed to parse analysis results."
        }
    }
}
