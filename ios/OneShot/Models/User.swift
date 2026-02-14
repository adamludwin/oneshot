import Foundation

struct User: Codable {
    let id: String
    let email: String?
    let name: String?
}

struct AuthResponse: Codable {
    let token: String
    let user: User
}

struct ConfigResponse: Codable {
    let openRouterApiKey: String?
    let analysisModel: String?
}
