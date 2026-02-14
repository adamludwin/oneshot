import SwiftUI
import AuthenticationServices

struct OnboardingView: View {
    @EnvironmentObject var auth: AuthService

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Hero
            VStack(spacing: 16) {
                Image(systemName: "camera.viewfinder")
                    .font(.system(size: 64, weight: .thin))
                    .foregroundStyle(.primary)

                Text("oneshot")
                    .font(.system(size: 42, weight: .bold, design: .default))
                    .tracking(-1)

                Text("Screenshot it. Forget it.\nWe got it.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Spacer()

            // Value props
            VStack(alignment: .leading, spacing: 20) {
                FeatureRow(
                    icon: "camera.fill",
                    title: "Just screenshot",
                    subtitle: "See a game schedule, school notice, or team text? Screenshot it."
                )
                FeatureRow(
                    icon: "sparkles",
                    title: "We extract everything",
                    subtitle: "Events, deadlines, to-dos — pulled out automatically."
                )
                FeatureRow(
                    icon: "rectangle.grid.1x2.fill",
                    title: "One dashboard",
                    subtitle: "Everything you need to know, at a glance."
                )
            }
            .padding(.horizontal, 24)

            Spacer()

            // Sign in
            VStack(spacing: 12) {
                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = [.fullName, .email]
                } onCompletion: { result in
                    auth.handleSignInResult(result)
                }
                .signInWithAppleButtonStyle(.white)
                .frame(height: 54)
                .cornerRadius(14)

                if auth.isLoading {
                    ProgressView()
                        .padding(.top, 4)
                }

                if let error = auth.error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 40)
        }
        .background(Color(.systemBackground))
    }
}

struct FeatureRow: View {
    let icon: String
    let title: String
    let subtitle: String

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(.primary)
                .frame(width: 36, height: 36)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
