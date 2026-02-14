import Foundation

class APIService {
    static let shared = APIService()

    #if DEBUG
    private let baseURL = "https://oneshot-api-production-ca5c.up.railway.app"
    #else
    private let baseURL = "https://oneshot-api-production-ca5c.up.railway.app"
    #endif

    private init() {}

    // MARK: - GET

    func get<T: Decodable>(path: String, authenticated: Bool = true) async throws -> T {
        var request = URLRequest(url: URL(string: baseURL + path)!)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if authenticated {
            try attachAuth(to: &request)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        let decoder = JSONDecoder()
        return try decoder.decode(T.self, from: data)
    }

    // MARK: - POST

    func post<T: Decodable>(path: String, body: [String: Any], authenticated: Bool = true) async throws -> T {
        var request = URLRequest(url: URL(string: baseURL + path)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        if authenticated {
            try attachAuth(to: &request)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        let decoder = JSONDecoder()
        return try decoder.decode(T.self, from: data)
    }

    // MARK: - POST (Codable body)

    func post<T: Decodable, B: Encodable>(path: String, encodableBody: B, authenticated: Bool = true) async throws -> T {
        var request = URLRequest(url: URL(string: baseURL + path)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(encodableBody)

        if authenticated {
            try attachAuth(to: &request)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)

        let decoder = JSONDecoder()
        return try decoder.decode(T.self, from: data)
    }

    // MARK: - DELETE

    func delete(path: String) async throws {
        var request = URLRequest(url: URL(string: baseURL + path)!)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try attachAuth(to: &request)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response, data: data)
    }

    // MARK: - Helpers

    private func attachAuth(to request: inout URLRequest) throws {
        guard let token = Self.getTokenFromKeychain() else {
            throw APIError.unauthorized
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    /// Read JWT directly from Keychain (no MainActor dependency)
    private static func getTokenFromKeychain() -> String? {
        let tokenKey = "com.oneshot.jwt"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tokenKey,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token
    }

    private func validateResponse(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard (200...299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw APIError.serverError(statusCode: http.statusCode, message: body)
        }
    }
}

enum APIError: LocalizedError {
    case unauthorized
    case invalidResponse
    case serverError(statusCode: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "Not authenticated. Please sign in."
        case .invalidResponse:
            return "Invalid server response."
        case .serverError(let code, let message):
            return "Server error (\(code)): \(message)"
        }
    }
}
