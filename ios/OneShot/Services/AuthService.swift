import Foundation
import AuthenticationServices
import SwiftUI

@MainActor
class AuthService: ObservableObject {
    @Published var isAuthenticated = false
    @Published var currentUser: User?
    @Published var isLoading = false
    @Published var error: String?

    private let tokenKey = "com.oneshot.jwt"
    private let userKey = "com.oneshot.user"

    init() {
        // Check for existing session
        if let token = getToken(), !token.isEmpty {
            isAuthenticated = true
            if let data = UserDefaults.standard.data(forKey: userKey),
               let user = try? JSONDecoder().decode(User.self, from: data) {
                currentUser = user
            }
        }
    }

    // MARK: - Sign In with Apple

    func handleSignInResult(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let identityTokenData = credential.identityToken,
                  let identityToken = String(data: identityTokenData, encoding: .utf8) else {
                self.error = "Failed to get Apple credentials"
                return
            }

            let fullName = credential.fullName
            let name = [fullName?.givenName, fullName?.familyName]
                .compactMap { $0 }
                .joined(separator: " ")
            let email = credential.email

            Task {
                await authenticateWithBackend(
                    identityToken: identityToken,
                    name: name.isEmpty ? nil : name,
                    email: email
                )
            }

        case .failure(let err):
            if (err as NSError).code == ASAuthorizationError.canceled.rawValue {
                // User canceled, not an error
                return
            }
            self.error = err.localizedDescription
        }
    }

    private func authenticateWithBackend(identityToken: String, name: String?, email: String?) async {
        isLoading = true
        error = nil

        do {
            let response: AuthResponse = try await APIService.shared.post(
                path: "/auth/apple",
                body: [
                    "identityToken": identityToken,
                    "name": name as Any,
                    "email": email as Any,
                ],
                authenticated: false
            )

            // Store token and user
            saveToken(response.token)
            currentUser = response.user

            if let userData = try? JSONEncoder().encode(response.user) {
                UserDefaults.standard.set(userData, forKey: userKey)
            }

            isAuthenticated = true
        } catch {
            self.error = "Sign in failed: \(error.localizedDescription)"
        }

        isLoading = false
    }

    // MARK: - Sign Out

    func signOut() {
        deleteToken()
        UserDefaults.standard.removeObject(forKey: userKey)
        currentUser = nil
        isAuthenticated = false
    }

    // MARK: - Keychain

    func getToken() -> String? {
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

    private func saveToken(_ token: String) {
        deleteToken()
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tokenKey,
            kSecValueData as String: data,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    private func deleteToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tokenKey,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
