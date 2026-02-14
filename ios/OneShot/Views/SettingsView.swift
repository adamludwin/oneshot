import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var auth: AuthService
    @State private var showSignOutConfirm = false
    @State private var showResetConfirm = false
    @State private var isResetting = false
    @State private var resetMessage: String?

    var body: some View {
        NavigationStack {
            List {
                // Account
                Section("Account") {
                    if let user = auth.currentUser {
                        if let name = user.name {
                            LabeledContent("Name", value: name)
                        }
                        if let email = user.email {
                            LabeledContent("Email", value: email)
                        }
                    }

                    Button("Sign Out", role: .destructive) {
                        showSignOutConfirm = true
                    }
                }

                // Data
                Section("Data") {
                    Button("Clear Dashboard and Re-scan") {
                        showResetConfirm = true
                    }
                    .disabled(isResetting)

                    LabeledContent("Version", value: "0.1.0")
                }

                // About
                Section {
                    Text("OneShot reads your screenshots, extracts events, deadlines, and to-dos using AI, and puts everything on one dashboard.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog("Sign out?", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) {
                    auth.signOut()
                }
            }
            .confirmationDialog("Re-scan all screenshots?", isPresented: $showResetConfirm, titleVisibility: .visible) {
                Button("Clear and Re-scan Everything") {
                    Task {
                        await clearDashboardAndResetScan()
                    }
                }
            } message: {
                Text("This clears current cards on the server, resets local screenshot sync, and rebuilds on next dashboard refresh.")
            }
            .alert("Data Reset", isPresented: Binding(
                get: { resetMessage != nil },
                set: { if !$0 { resetMessage = nil } }
            )) {
                Button("OK") {}
            } message: {
                Text(resetMessage ?? "")
            }
        }
    }

    private func clearDashboardAndResetScan() async {
        isResetting = true
        defer { isResetting = false }

        do {
            struct OkResponse: Codable { let ok: Bool }
            let _: OkResponse = try await APIService.shared.post(path: "/api/items/reset", body: [:])
            PhotoService.shared.resetSync()
            resetMessage = "Dashboard cleared. Go back to Dashboard and pull to refresh to rebuild from screenshots."
        } catch {
            resetMessage = "Reset failed: \(error.localizedDescription)"
        }
    }
}
